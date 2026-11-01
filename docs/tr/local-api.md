# OpenAI uyumlu Local API

[Ana sayfa](README.md) · [English](../en/local-api.md)

Local API, kendi OpenAI uyumlu metin/görsel sunucunu Enhance, Brainstorm, varyasyon, görsel üretimi ve referanslı düzenleme işlemlerine bağlar. Resmî OpenAI sağlayıcısından ayrı bir seçenektir.

## Masaüstü kurulumu

**Provider keys** içindeki Local provider alanını doldur:

| Alan | Örnek |
| --- | --- |
| Local base URL | `http://localhost:20128/v1` |
| Local text model ID | `cx/gpt-6.1-sol` |
| Local image model ID | `cx/gpt-image-2.5` |
| Local API key | Sunucunun anahtarı; kimlik doğrulaması gerekmiyorsa boş bırak |

Kaydet; üretim çubuğundan veya **AI settings → Provider routing** bölümünden **Local API** seç. Bu sağlayıcıda mevcut model seçenekleri birer ayar önseçimidir: gerçek model yukarıdaki metin/görsel ID'sinden alınır ve sağlayıcının yanında gösterilir. Tüm görsel önseçimleri aynı görsel ID'sini, tüm metin önseçimleri aynı metin ID'sini kullanır. Mevcut sağlayıcıların Auto sırası korunur. Yerel ayar veya anahtar kaydedilmeden Local API etkinleşmez.

Sunucunun desteklediği herhangi bir model ID'sini girebilirsin. Örneğin `cx/gpt-image-2.5-flare`, `cx/gpt-image-2.5-sunburst`, `cx/gpt-image-2`, `cx/gpt-image-1.5`, `cx/gpt-5.6-sol-image`, `cx/gpt-5.6-terra-image` veya `cx/gpt-5.6-luna-image`. Modelleri ve desteklenen ayarları arka uç belirler.

Anahtar ve yerel ayarlar macOS Anahtar Zinciri veya Windows Credential Manager'da saklanır; yerel sunucuya özel süreç pipe'ından aktarılır. Boş anahtar alanı kayıtlı anahtarı korur; **Remove** anahtarı siler. Boş yapılandırma alanları gösterilen varsayılanları geri yükler.

## Web kurulumu

Alan sahibi sunucuda `LOCAL_API_BASE_URL`, `LOCAL_TEXT_MODEL`, `LOCAL_IMAGE_MODEL` ve gerekiyorsa `LOCAL_API_KEY` tanımlar. Kullanılmayan model ID'sini boş bırakarak o işlem türünü kapatabilirsin. `LOCAL_ENABLED=false` sağlayıcıyı kapatır. Web ortam değişkenlerini değiştirdikten sonra yeniden deploy et.

Adres arka uçtan erişilebilir olmalıdır. Vercel'deki `localhost`, tarayıcıyı açan bilgisayarı değil Vercel fonksiyonunu belirtir. Anahtarları `VITE_*` değişkenlerine, kaynak koda veya URL'ye ekleme.

## Desteklenen API biçimi

- Metin: standart mesajlar ve isteğe bağlı inline görsellerle `POST /chat/completions`; `stream: false`. Brainstorm JSON Schema yapılandırılmış çıktı ister. Sağlayıcıya özel reasoning alanları gönderilmez; model kendi varsayılanlarını kullanır.
- Görsel: JSON `POST /images/generations` veya `/images/edits`. Referanslar `images: [{image_url: "data:..."}]` olarak gönderilir. Düzenleme ucu OpenAI'ın JSON istek biçimini desteklemelidir.
- Yanıtlar: OpenAI `data[].b64_json`, inline görsel data URL'si, sağlayıcının kendi origin'indeki görsel URL'si veya tamamlanmış OpenAI SSE görsel olayı. Yalnızca kısmi çıktı içeren akışlar ve başka origin'deki indirmeler reddedilir; dış indirme URL'si döndüren arka uçlarda base64 kullan.
- İşler kuyruktan geçer; sağlayıcı/model bilgileri galeriye kaydedilir. Açıkça seçilen düzenleme alanının dışındaki kaynak pikseller korunur. Kuyruktaki iş gönderilmeden adres veya görsel ID'si değişirse iş reddedilir; güncel ayarlarla yeni iş oluştur.
- Belirsiz gönderim otomatik tekrarlanmaz veya başka sağlayıcıya taşınmaz. Arka uç sonlu ve negatif olmayan `usage.cost` döndürmedikçe maliyet bilinmiyor olarak kalır.

Local API video üretmez ve YouTube görüntüsünü doğrudan okumaz. Görüntü analizi için Gemini'yi doğrudan veya OpenRouter üzerinden kullan; yerel metin modeli doğrulanmış gözlemlerden son brief'i hazırlayabilir.
