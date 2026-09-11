/**
 * Alış Faturaları artık ayrı bir sayfa değil: Stok sayfasının "Alış" sekmesi
 * (madde 4 taşıması — bkz. `@/bilesen/alis-sekmesi` ve `app/stok/page.tsx`).
 *
 * Bu adres yine de çalışmalı: eski yer imleri ve program içi bağlantılar
 * kırılmasın diye `/stok?sekme=alis`'e yönlendirir.
 */

import { redirect } from 'next/navigation';

export default function AlisSayfasi() {
  redirect('/stok?sekme=alis');
}
