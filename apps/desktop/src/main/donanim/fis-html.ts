/**
 * Fiş belgesinin GÖRÜNTÜ için HTML'e çevrilmesi (§13.2).
 *
 * Fiş görüntü olarak basıldığı için yerleşim artık yazıcının tek aralıklı
 * fontuna mahkûm değil: oransal yazı tipi, hizalı rakamlar ve tipografik
 * hiyerarşi kullanılabilir. Tasarımın taşıdığı iki karar:
 *
 *  - TOPLAM ters bir bant içinde (siyah zemin, beyaz yazı). Termal kağıtta en
 *    güçlü vurgu budur; müşteri fişe baktığında gözü doğrudan ödediği tutara
 *    gider.
 *  - Ürün adı kalın, altında gri ile "2 ad × 72,50". Miktar ve birim fiyat
 *    fişin asıl bilgisi değildir; sorulduğunda bakılır, okumayı yavaşlatmaz.
 *
 * KAĞIT PAHALIDIR: boşluklar bilinçli olarak sıkı tutulur. Premium his
 * boşluktan değil tipografiden gelir; günde yüzlerce fiş basan bir işletmede
 * her satırın yüksekliği paraya dönüşür.
 */

import { code128Cizimi } from '@market/shared';
import type { EkstreBelgesi, FisBelgesi } from './fis-belge.js';

/** HTML'e gömülecek metni kaçırır — ürün adında `<` geçebilir. */
function kacir(metin: string): string {
  return metin.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Ölçüler kağıt genişliğine ORANLANIR.
 *
 * 58 mm kağıt 384, 80 mm kağıt 576 nokta basar. Punto sabit verilseydi dar
 * kağıtta ürün adları alt satıra taşar, fiş iki katı uzardı.
 */
function olcekler(enNokta: number) {
  const k = enNokta / 576;
  return {
    kenar: Math.round(20 * k),
    marka: Math.round(40 * k),
    govde: Math.round(21 * k),
    kucuk: Math.round(18 * k),
    mini: Math.round(16 * k),
    toplam: Math.round(30 * k),
  };
}

/**
 * Fiş ve ekstrenin PAYLAŞTIĞI görsel dil.
 *
 * İkisi ayrı yerleşimler ama aynı işletmenin belgeleri: yazı tipi, çizgi
 * kalınlığı, ters bant ve gri ton aynı olmalı. Ayrı ayrı yazılsaydı biri
 * güncellenip öteki unutulur, aynı kasadan iki farklı kimlikte kağıt çıkardı.
 */
function ortakStil(o: ReturnType<typeof olcekler>, enNokta: number): string {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#fff;color:#000}
body{width:${enNokta}px;
  font-family:"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif;
  font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;
  -webkit-font-smoothing:none;font-smooth:never;
  font-size:${o.govde}px;line-height:1.35}
.pad{padding:${o.kenar}px ${o.kenar}px ${Math.round(o.kenar * 1.2)}px}
.orta{text-align:center}
.gri{opacity:.72}
.mini{font-size:${o.mini}px}
.kucuk{font-size:${o.kucuk}px}
.marka{font-size:${o.marka}px;font-weight:800;letter-spacing:${Math.round(o.marka * 0.06)}px;line-height:1.1}
.kurum{font-size:${o.kucuk}px;margin-top:${Math.round(o.kenar * 0.15)}px}
.baslik{font-size:${o.kucuk}px;font-weight:700;letter-spacing:3px;margin-top:${Math.round(o.kenar * 0.3)}px}
.cizgi{border-top:2px solid #000;margin:${Math.round(o.kenar * 0.5)}px 0}
.ince{border-top:1px solid #000;margin:${Math.round(o.kenar * 0.4)}px 0}
.nokta{border-top:2px dotted #000;margin:${Math.round(o.kenar * 0.5)}px 0}
.cift{display:flex;justify-content:space-between;gap:${o.kenar}px;line-height:1.5}
.cift span:last-child{white-space:nowrap;font-weight:600}
.toplam{background:#000;color:#fff;display:flex;justify-content:space-between;
  gap:${o.kenar}px;padding:${Math.round(o.kenar * 0.5)}px ${Math.round(o.kenar * 0.7)}px;
  margin:${Math.round(o.kenar * 0.5)}px 0;font-size:${o.toplam}px;font-weight:800;letter-spacing:1px}
.uyari{font-size:${o.mini}px;font-weight:700;letter-spacing:1px;margin-top:${Math.round(o.kenar * 0.5)}px}`;
}

export function belgeHtml(belge: FisBelgesi, enNokta: number): string {
  const o = olcekler(enNokta);

  const bilgi = belge.meta
    .map((s) => `<div class="cift mini"><span class="gri">${kacir(s.etiket)}</span><span>${kacir(s.deger)}</span></div>`)
    .join('');

  const kalemler = belge.kalemler
    .map((k) => {
      const detay = `${kacir(k.miktarMetni)} × ${kacir(k.birimFiyatMetni)}${k.iskontoMetni ? ` · iskonto ${kacir(k.iskontoMetni)}` : ''}`;
      return `<div class="kalem"><div class="sol"><div class="ad">${kacir(k.ad)}</div><div class="detay gri">${detay}</div></div><div class="tutar">${kacir(k.tutarMetni)}</div></div>`;
    })
    .join('');

  const ara = belge.araSatirlar
    .map((s) => `<div class="cift"><span class="gri">${kacir(s.etiket)}</span><span>${kacir(s.deger)}</span></div>`)
    .join('');

  /*
   * Barkod ÇUBUK olarak çizilir, yazıcının barkod komutuyla değil: görüntü
   * basımında yazıcının kendi barkod üreteci hiç devreye girmez. Modül
   * genişliği tam sayı nokta olmalı — kesirli değer termal kafada çubukları
   * eşitsiz bastırır ve okuyucu barkodu okuyamaz.
   */
  const cizim = belge.barkod ? code128Cizimi(belge.barkod) : null;
  const barkodBlogu = cizim
    ? `<div class="barkod orta"><div class="cubuklar">${cizim.desenler
        .map((genislik, sira) => {
          const modul = Math.max(1, Math.floor((enNokta * 0.8) / cizim.toplamModul));
          return `<i style="width:${genislik * modul}px;background:${sira % 2 === 0 ? '#000' : '#fff'}"></i>`;
        })
        .join('')}</div><div class="mini gri">${kacir(cizim.metin)}</div></div>`
    : '';

  const odemeler = belge.odemeler
    .map((s) => `<div class="cift"><span class="gri">${kacir(s.etiket)}</span><span>${kacir(s.deger)}</span></div>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${ortakStil(o, enNokta)}
.barkod{margin-top:${Math.round(o.kenar * 0.6)}px}
.barkod .cubuklar{display:flex;justify-content:center;align-items:flex-end;height:${Math.round(o.govde * 2.2)}px}
.barkod i{display:block;height:100%}
</style></head><body><div class="pad">
<div class="orta">
  <div class="marka">${kacir(belge.isletmeAdi)}</div>
  ${belge.isletmeSatirlari.map((s) => `<div class="kurum gri">${kacir(s)}</div>`).join('')}
  ${belge.baslik ? `<div class="baslik">${kacir(belge.baslik)}</div>` : ''}
  ${belge.damga ? `<div class="baslik">*** ${kacir(belge.damga)} ***</div>` : ''}
</div>
<div class="cizgi"></div>
${bilgi}
<div class="ince"></div>
${kalemler}
<div class="ince"></div>
${ara}
<div class="toplam"><span>${kacir(belge.toplam.etiket)}</span><span>${kacir(belge.toplam.deger)}</span></div>
${odemeler}
<div class="nokta"></div>
<div class="orta kucuk">
  ${belge.altMetin ? `<div>${kacir(belge.altMetin)}</div>` : ''}
  <div class="uyari">${kacir(belge.yasalUyari)}</div>
  ${belge.yasalAlt ? `<div class="mini gri" style="margin-top:${Math.round(o.kenar * 0.2)}px">${kacir(belge.yasalAlt)}</div>` : ''}
</div>
${barkodBlogu}
</div></body></html>`;
}


/**
 * Cari hesap ekstresi çizimi (§10.7).
 *
 * Fişten AYRI bir yerleşim: ekstre bir tablodur, satış listesi değil. Her
 * hareket tarih, açıklama, tutar ve yürüyen bakiye taşır; dört sütun aynı
 * satırda hizalanmazsa göz rakamları takip edemez. Eski ekstre tarihi ve
 * açıklamayı bir satıra, tutarı ve bakiyeyi alt satıra koyuyordu; okunması
 * için parmakla takip etmek gerekiyordu.
 */
export function ekstreHtml(belge: EkstreBelgesi, enNokta: number): string {
  const o = olcekler(enNokta);

  const meta = belge.meta
    .map((s) => `<div class="cift mini"><span class="gri">${kacir(s.etiket)}</span><span>${kacir(s.deger)}</span></div>`)
    .join('');

  const hareketler = belge.hareketler
    .map(
      (h) =>
        `<div class="hareket"><div class="sol"><div class="ad">${kacir(h.aciklama)}</div><div class="detay gri">${kacir(h.tarihMetni)}</div></div>` +
        `<div class="sagda"><div class="tutar">${h.borcMu ? '+' : '-'}${kacir(h.tutarMetni)}</div><div class="detay gri">${kacir(h.bakiyeMetni)}</div></div></div>`,
    )
    .join('');

  const ozet = belge.ozet
    .map((s) => `<div class="cift"><span class="gri">${kacir(s.etiket)}</span><span>${kacir(s.deger)}</span></div>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${ortakStil(o, enNokta)}
.hareket{display:flex;justify-content:space-between;gap:${o.kenar}px;margin:${Math.round(o.kenar * 0.3)}px 0}
.hareket .sol{flex:1;min-width:0}
.hareket .ad{font-weight:600}
.hareket .detay{font-size:${o.mini}px;margin-top:1px}
.hareket .sagda{text-align:right;white-space:nowrap}
.hareket .tutar{font-weight:700}
.aciklama{font-size:${o.kucuk}px;line-height:1.45;margin-top:${Math.round(o.kenar * 0.4)}px;
  border-left:3px solid #000;padding-left:${Math.round(o.kenar * 0.5)}px}
.sutunbasi{display:flex;justify-content:space-between;font-size:${o.mini}px;letter-spacing:2px;
  opacity:.7;padding-bottom:${Math.round(o.kenar * 0.2)}px}
</style></head><body><div class="pad">
<div class="orta">
  <div class="marka">${kacir(belge.isletmeAdi)}</div>
  <div class="baslik">${kacir(belge.baslik)}</div>
</div>
<div class="cizgi"></div>
${meta}
<div class="ince"></div>
<div class="sutunbasi"><span>İŞLEM</span><span>TUTAR / BAKİYE</span></div>
${hareketler}
<div class="ince"></div>
${ozet}
<div class="toplam"><span>${kacir(belge.bakiye.etiket)}</span><span>${kacir(belge.bakiye.deger)}</span></div>
<div class="aciklama">${kacir(belge.bakiyeAciklamasi)}</div>
<div class="nokta"></div>
<div class="orta uyari">${kacir(belge.yasalUyari)}</div>
</div></body></html>`;
}
