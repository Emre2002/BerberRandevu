# SECURITY_DECISIONS.md

Yalnızca kullanıcı kararı gerektiren konular. Uygulama kodu bu aşamada değişmez.

---

## 1) Berberler username ile giriş yapmaya devam edecek mi?

**A:** Evet — UI’da username + password (mevcut `giris.js` deneyimi).  
**B:** Hayır — e-posta (veya telefon) ile Firebase Auth standart girişi.

| | A | B |
|---|---|---|
| Güvenlik | Username→Auth eşlemesi ek bileşen (lookup belgesi korunmalı) | Daha az özel eşleme |
| UX | Mevcut alışkanlık korunur | Kullanıcıların e-posta/telefon girmesi gerekir |
| Migration | `usernames/{username}` → uid + Auth user | Username alanından e-posta toplama/zorunlu güncelleme |

**Öneri:** A (username UX + arka planda Auth).  
**Karar yoksa güvenli varsayılan:** A; lookup belgesi public okunamaz, yazım yalnız Admin SDK/CF.

---

## 2) Firebase Auth sentetik/özel e-posta eşlemesiyle mi kullanılacak?

**A:** Sentetik e-posta (`{username}@users.berberrandevu.internal` benzeri) + `signInWithEmailAndPassword`.  
**B:** Gerçek e-posta zorunlu; username yalnız görünen ad.

| | A | B |
|---|---|---|
| Güvenlik | E-posta doğrulama zayıf/yok; şifre reset akışı tasarlanmalı | Password reset doğal |
| UX | Username aynı kalır | E-posta zorunlu |
| Migration | Otomatik eşleme kolay | Eksik e-postalalı berberler (`berberler.email` boş olabilir) engeli |

**Öneri:** A (kısa vadede) + uzun vadede isteğe bağlı gerçek e-posta bağlama.  
**Karar yoksa güvenli varsayılan:** A; reset için trusted admin/CF veya ileride e-posta bağlama.

---

## 3) Düz metin şifreler: tek seferlik Admin SDK taşıma mı, zorunlu reset mi?

**A:** Güvenilir Admin SDK ortamında mevcut `berberler.password` ile `createUser` / `updateUser`, sonra Phase 7’de alan silme.  
**B:** Password taşıma yok; tüm berberler reset / ilk girişte yeni parola.

| | A | B |
|---|---|---|
| Güvenlik | Taşıma anında şifreler hâlâ bilinir (export riski); script sızıntısı kritik | Eski sızıntıya karşı daha iyi (herkes yeni parola) |
| UX | Kesintisiz giriş | Toplu şifre yenileme yükü |
| Migration | Tek seferlik trusted job; **client script yasak** | İletişim + support yükü |

**Öneri:** A + kısa dual-run + hızlı Phase 7 silme; bilinen sızıntı şüphesi varsa B.  
**Karar yoksa güvenli varsayılan:** B (zorunlu reset) — güvenlik öncelikli; operasyon maliyeti bilinçli.

---

## 4) Hangi işletme/hizmet bilgileri public okunabilir?

**A:** Yalnız `publicBarbers` (mevcut `buildPublicBarberData`: name, adres, telefon, saatler, services, `bookingOpen`, status; **username/password/telegram/abonelik yok**). `berberler` public deny.  
**B:** Müşteri doğrudan `berberler` okumaya devam (`app.js` bugün okuyor) — hassas alanlar rules ile maskelenemez (alan seviyesinde gizleme yok).

| | A | B |
|---|---|---|
| Güvenlik | Hassas alanlar korunur | password/telegram/abonelik sızıntı riski devam |
| UX | `app.js` publicBarbers’a geçmeli | Değişiklik az |
| Migration | Client okuma yolu değişir | Rules sıkılaştırılamaz |

**Öneri:** A.  
**Karar yoksa güvenli varsayılan:** A; slot availability için ayrı CF veya dar mirror.

---

## 5) Super admin custom claims ile mi yönetilecek?

**A:** `request.auth.token.superAdmin == true` (staging taslakla uyumlu); atama yalnız Admin SDK.  
**B:** Yalnız Firestore `admins/{uid}` belgesi; claim yok.

| | A | B |
|---|---|---|
| Güvenlik | Claim token’da; client atayamaz | Belge rules ile korunmalı; her okumada get gerekir |
| UX | Token refresh sonrası etkili | Anında belge güncellemesi |
| Migration | `superAdminAuth.js` hash kaldırılır | Hash kaldırılır; bootstrap admin belgesi |

**Öneri:** A (+ isteğe bağlı `admins/{uid}` audit kaydı).  
**Karar yoksa güvenli varsayılan:** A; client/localStorage yetki sayılmaz.

---

## 6) Hangi işlemler doğrudan Firestore, hangileri Cloud Functions?

**A (önerilen bölünme):**
| CF (Admin SDK + kendi authz) | Doğrudan Firestore (Auth+rules) |
|------------------------------|----------------------------------|
| Public `createAppointment` | Berber kendi `blockedSlots` |
| Admin appointment create/update (veya sıkı rules) | Berber kendi randevu okuma / sınırlı update |
| `activateSubscriptionCode`, kod üretimi | CRM customer read/update (tenant) |
| `createBarber` / hassas alan / `syncPublicBarber` | `publicBarbers` get |
| Telegram / rate limit yazımları | — |

**B:** Mümkün olduğunca her yazım CF — daha az rules karmaşıklığı, daha çok latency/maliyet.

| | A | B |
|---|---|---|
| Güvenlik | İyi (kritik yollar CF) | En sıkı yazım kontrolü |
| UX | Admin panel responsive kalır | Her işlem callable |
| Migration | Mevcut CF genişletilir | Büyük client refaktör |

**Öneri:** A.  
**Karar yoksa güvenli varsayılan:** A; public appointment create kesinlikle CF; `forceClient` production’da kaldırılır.

---

## 7) Berber rolleri: yalnız owner mı, employee var mı?

**Kod gerçeği:** Ayrı `employees` koleksiyonu / rol modeli **yok**. `pendingBarbers.ownerName` başvuru alanı; runtime rol değil. Tek giriş: dükkan `username`/`password`.

**A:** Yalnız `owner` membership (1:1 uid↔slug başlangıç).  
**B:** Şimdi `employee` / çoklu kullanıcı modeli ekle.

| | A | B |
|---|---|---|
| Güvenlik | Daha küçük yüzey | Rules/CF’de rol matrisi gerekir |
| UX | Mevcut modele uygun | Personel hesabı özelliği |
| Migration | Basit | Kapsam şişer |

**Öneri:** A; employee ayrı ürün fazı.  
**Karar yoksa güvenli varsayılan:** A — uydurma employee rolü eklenmez.

---

## Karar kayıt tablosu (doldurulacak)

| # | Konu | Seçim | Tarih |
|---|------|-------|-------|
| 1 | Username login | _bekliyor_ | |
| 2 | Sentetik e-posta | _bekliyor_ | |
| 3 | Password taşıma vs reset | _bekliyor_ | |
| 4 | Public veri yüzeyi | _bekliyor_ | |
| 5 | Super admin claim | _bekliyor_ | |
| 6 | CF vs direct write | _bekliyor_ | |
| 7 | Owner-only vs employee | _bekliyor_ | |
