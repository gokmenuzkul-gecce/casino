# loginxgamesapi / gitamus — gönderilecek talep (Türkçe)

Bu mesaj, dört Stage kimlik setini (Pragmatic, PG Soft, Amatic, Amusnet) veren
kişiye gönderilmek içindir. Köşeli parantezli alanları doldurun.

---

**Kime:** [entegrasyon yetkilisi]
**Konu:** Aurora — Stage API için oyun açma ve cüzdan (seamless wallet) dokümantasyonu

Merhaba,

Stage bilgilerimiz elimizde ve katalog şu an çalışıyor: `GET /GameList` bearer
token ile dört hostta da yanıt veriyor (Pragmatic Play 672, PG Soft 155, Amatic
232, Amusnet 343 oyun). Bunun için teşekkürler.

Ancak oyunları gerçekten çalıştırmak için entegrasyonun oyun açma ve cüzdan
kısımları elimizde yok. Şunları rica ediyoruz:

1. **API dokümantasyonunun tamamı.** Halihazırda yalnızca `/GameList` yanıt
   veriyor; denediğimiz hiçbir oyun-açma yolu (404) ve `/GameList` üzerindeki
   hiçbir parametre (`type`, `vendor`, `limit`, `page`) çalışmıyor. Postman
   koleksiyonu, PDF veya endpoint listesi yeterli — yollar, metotlar ve alan
   adları bizim için yeterli.

2. **Oyun açma (launch) endpoint'i.** Özellikle: yol, istek alanları (oyuncu
   referansı, `gameid` veya `symbol`, para birimi, dil, real/demo, çıkış URL'i)
   ve yanıt yapısı (launch URL, oturum/token id, geçerlilik süresi). Launch
   URL'i ne kadar geçerli ve tek kullanımlık mı?

3. **Seamless-wallet callback sözleşmesi.** Sizin tarafınızdan bizim
   endpoint'imize çağrı gelecek, dolayısıyla tam tanıma ihtiyacımız var:
   - action adları ve istek alanları (balance / debit / credit / rollback),
   - bizden beklenen yanıt gövdesi — yetersiz bakiye durumunu nasıl
     bildirmeliyiz?
   - **imza şeması.** Bu çağrı ailesinin bir tanımında `timestamp` ve `key`
     geliyor ve `key = md5(timestamp + salt_key)` deniyor. Şemanız bu mu?
     `salt_key` nedir, hangi header'da taşınıyor? Bizim mevcut callback
     doğrulayıcımız HMAC-SHA256 bekliyor ve başka bir şemayı reddeder; bu
     yüzden tam olarak sizin belirttiğinizi uygulayacağız. Para hareketi olduğu
     için tahmin etmiyoruz — algoritma farklıysa referans kod parçasını
     gönderin.

4. **Para birimi ve callback URL'i.** Tanımladığımız callback adresi:
   ```
   https://work-1-tyusmaoyqerdyrfr.prod-runtime.all-hands.dev/webhooks/aggregator/gregmorn/wallet
   ```
   Bunun hangi para birimleri için kayıtlı olduğunu teyit edin. (Canlıya
   çıkmadan önce kendi üretim alan adımıza taşıyacağız.)

5. **Canlı masalar.** Dört vendor setinizin tamamı slot ve instant oyun.
   İçlerinde canlı krupiye masası bulamadık. Bu API üzerinde Pragmatic Play
   Live veya başka bir canlı masa sağlayıcınız var mı? Varsa o setin
   bilgilerini ve host'unu paylaşın. Yoksa canlı masaları ayrı bir
   entegrasyonda tutacağız.

6. **IP allowlist.** Stage ortamı için çıkış IP'lerimizi allowlist'e ekleyin
   (Prod'dan ayrı, gerekirse host başına ayrı):
   ```
   [ÇIKIŞ IP(LERİ)]
   ```

7. **Tek bir uçtan uca örnek tur.** Bir test oyuncusu için oturum açın ve debit
   ile eşleşen credit callback gövdelerinin birebir örneklerini gönderin. Bu
   tek örnek, kalan belirsizliğin çoğunu ortadan kaldırır.

1–3 maddeler elimize geçtiğinde oyun açma ve cüzdan köprüsünü uygulayıp aynı gün
Stage'de gerçek bir tur çalıştırabiliriz.

Teşekkürler,

[İsim]
[Rol], Aurora
[E-posta] · [Telefon]

---

## Notlar (mesaja dahil değil)

- **Madde 3 en kritik.** Callback imzası teyit edilmeden tek bir bahis bile
  işlemez. Katalog çalışıyor ama para akışı orada duruyor.
- **Madde 2 gelmeden katalog import edilmemeli.** Yoksa ~1.400 oyun lobiye
  girer, hepsi tıklamada hata verir.
- **Madde 5 cevabı önemli.** "Canlı masa yok" derse canlı masa işi ayrı bir
  sağlayıcıya kalır.
- **Tasarım sorusu** (onlara değil, bize): Dört host + dört kimlik = sağlayıcı
  başına ayrı bağlantı. Bu tek adaptör (alt kimliklerle) mi, dört ayrı
  entegrasyon mu? Motorumuz şu an tek aktif `GAME_AGGREGATOR` varsayıyor;
  cevap implementasyonu belirler.
