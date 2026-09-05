/**
 * Panel renk sistemi — masaüstü kasa uygulamasıyla AYNI anlamsal isimler.
 *
 * Renkler CSS değişkenlerinden "R G B" kanal biçiminde okunur; bu sayede
 * Tailwind saydamlık eki (`bg-yuzey/60`) çalışır ve tek bir `data-tema`
 * özniteliğiyle açık/koyu tema değişir (global.css).
 *
 * @type {import("tailwindcss").Config}
 */
const kanal = (ad) => `rgb(var(${ad}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        zemin: kanal("--zemin"),
        yuzey: { DEFAULT: kanal("--yuzey"), 2: kanal("--yuzey-2"), 3: kanal("--yuzey-3"), 4: kanal("--yuzey-4") },
        cizgi: { DEFAULT: kanal("--cizgi"), kuvvetli: kanal("--cizgi-kuvvetli"), ince: kanal("--cizgi-ince") },
        metin: { DEFAULT: kanal("--metin"), 2: kanal("--metin-2"), 3: kanal("--metin-3"), 4: kanal("--metin-4") },
        vurgu: {
          DEFAULT: kanal("--vurgu"),
          koyu: kanal("--vurgu-koyu"),
          yumusak: kanal("--vurgu-yumusak"),
          uzeri: kanal("--vurgu-uzeri"),
        },
        uyari: { DEFAULT: kanal("--uyari"), yumusak: kanal("--uyari-yumusak"), cizgi: kanal("--uyari-cizgi") },
        tehlike: {
          DEFAULT: kanal("--tehlike"),
          koyu: kanal("--tehlike-koyu"),
          yumusak: kanal("--tehlike-yumusak"),
          cizgi: kanal("--tehlike-cizgi"),
        },
        bilgi: { DEFAULT: kanal("--bilgi"), yumusak: kanal("--bilgi-yumusak"), cizgi: kanal("--bilgi-cizgi") },
        ortu: kanal("--ortu"),
      },
    },
  },
  plugins: [],
};
