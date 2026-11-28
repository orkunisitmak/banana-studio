<p align="center">
  <img src="../assets/brand.svg" width="680" alt="Banana Studio" />
</p>

<p align="center"><strong>Bir fikirden görsele, YouTube kapağına ve videoya.</strong><br />Kendi API anahtarlarınla çalışan açık kaynak yaratıcı çalışma alanı.</p>

<p align="center">
  <a href="../../README.md">English</a> · <strong>Türkçe</strong> ·
  <a href="https://github.com/orkunisitmak/banana-studio/releases/latest">Mac / Windows indir</a> ·
  <a href="#özellikler">Özellikler</a> · <a href="#web-kurulumu">Web kurulumu</a>
</p>

<p align="center"><img src="../assets/gallery-real.jpg" width="1200" alt="Proje sahibinin gerçek iPhone kapak üretimleri, kişi referansları, prompt ve üretim kontrolleriyle web galerisinde" /></p>

<p align="center"><sub>Proje sahibinin hesabındaki gerçek üretimler ve arayüz görüntüleri, izniyle paylaşılmıştır. <a href="../assets/README.md">Demolar hakkında</a></sub></p>

**Banana Studio; görsel üretimi, seçili alan düzenleme, kapak planlama ve video üretimini aynı galeride toplar.** Bir cümleyle, referans görsellerle veya YouTube videosuyla başla. Brainstorm ile farklı fikirler keşfet, Enhance ile talimatını geliştir, sonuçları üret ve karşılaştır. Mac veya Windows uygulamasını kullanmak için kod yazman gerekmez.

Uygulama [MIT lisansıyla](../../LICENSE) ücretsizdir. Yapay zekâ servisleri API kullanımını ayrıca ücretlendirir; model kredisi dahil değildir. Üretim için internet bağlantısı gerekir.

<a id="özellikler"></a>

## Brainstorm ile fikirler keşfet

Tek brief'ten **birbirinden farklı fikirler**, her fikir için de birden fazla görsel oluştur. Genel fikirler için **Simple**, kapak konseptleri için **YouTube** modunu seç. Fikir sayısı ve fikir başına görsel sayısı ayrıdır: beş fikir × dört görsel, yirmi sonuç üretir.

Brainstorm; brief'ini, seçtiğin People kayıtlarını ve referansların rollerini kullanır. YouTube kapaklarında okunabilir kompozisyon, kameraya bakan kişiler ve brief'te sabit kıyafet istemediysen fikirler arasında farklı kombinler için talimat verir. Kendi yaratıcı yönlendirmelerin de isteğin parçasıdır.

<p align="center"><img src="../assets/brainstorm-real.jpg" width="1000" alt="Gerçek kapakların üzerinde Brainstorm paneli: YouTube modu, beş fikir, aynı kişiye ait fotoğraf grubu ve üretilecek görsel toplamı" /></p>

## Enhance ile promptunu geliştir

Kısa fikrini kendi cümlelerinle yaz. **Enhance**, seçili görsel veya video modeline uygun daha açık talimatlar hazırlar: kişi/nesne, kompozisyon, ışık, referans rolleri; videoda hareket ve zamanlama. Alan düzenleme içinde de çalışır. Sonucu kontrol et, kendin düzenle veya **Revert** ile ilk taslağına dön.

Türkçe taslaklardan da üretim açıklamaları İngilizce hazırlanır; görselde görünmesini istediğin yazılar, özel isimler ve alıntılanan diyaloglar istenen dilde kalır. **AI settings** bölümünde **Claude Opus 5.5, GPT-6.2 Sol veya Gemini 4 Hydrogen** ve düşünme seviyesini seç. Başlangıç ayarı **Opus 5.5 / Medium**. Kayıt varsa kullanılan hazırlama modeli ve düşünme seviyesi detaylarda saklanır.

## Bir alanı düzenle, geri kalanını koru

**Edit image** aç, içi dolan serbest çizim **Mask** veya **Rectangle** ile alan seç, değişikliği anlat. Her seçim bir katmandır: **Shift + çizim** yeni katman ekler; yatay şeritten katmanı seçebilir, yeniden çizebilir veya kaldırabilirsin. Ek görsel referansı yükle, edit promptunda `@` ile kullan. Modeli, kaliteyi ve görsel sayısını seç; istersen Enhance et.

**Son seçimin dışındaki pikseller kaynak görselden korunur.** Referans eklemek normal üretim akışında kalır; korumalı edit yalnızca açıkça alan seçtiğinde başlar. Yeni siluet gerektiren değişikliklerde yeterli çevreyi de seç: elde tutulan nesneyi kaldırmak için el ve bileği dahil etmek gerekebilir.

<p align="center"><img src="../assets/area-edit-real.jpg" width="1000" alt="Gerçek üretilmiş kapakta alan düzenleme: başlık ve fiyat dikdörtgen katmanda seçili; kişinin yüzü seçimin dışında" /></p>

Editler iş olarak arka planda ilerler; ilerlemeyi ve yeni galeri sonuçlarını takip edebilirsin. Önceki sonucu beklemeden başka deneme gönder. **Kaynak/sonuç sliderı** ile karşılaştır, kaynağa dön veya **Edit this result** ile yeni sonuç üzerinden devam et.

<details>
<summary>Edit kontrollerini ve önce/sonra karşılaştırmasını gör</summary>

<p><img src="../assets/edit-controls-real.jpg" width="1000" alt="Gerçek edit prompt kutusu: referans yükleme, model, kalite, artı/eksi görsel sayısı ve Enhance" /></p>
<p><img src="../assets/comparison-real.jpg" width="1000" alt="Kaynak ve editlenen kapağın slider ile karşılaştırması: portre korunurken başlık değişiyor" /></p>

Yukarıdaki dikdörtgen ve taslak, edit kontrollerini göstermek için hazırlanmıştır; bu ekran görüntüleri için yeni üretim gönderilmemiştir. Karşılaştırma aynı hesaptaki daha önce tamamlanmış bir editi gösterir.

</details>

## YouTube videosundan kapak üretimine

**YT** ile kanal veya video bul, videoyu analiz et, bölümün ana vaadini kontrol et, gösterilecek kişileri seç. Brief'i Brainstorm'a gönder veya üretim öncesinde düzenle. Kanalın önceki kapaklarını stil, People fotoğraflarını kimlik, ürün görsellerini nesne referansı olarak ekle. Bitmiş kapağı **YouTube Preview** ile örnek bir YouTube yerleşiminde incele.

Videoyu okuma ve yaratıcı brief ayrı sağlayıcı akışları kullanır. Gerekli kombinasyonu [anahtar rehberi](models.md) açıklar. [Kapak üretim adımlarını izle →](guide.md#youtube-kapağı-planla)

## Metin, görsel ve referanslarla video üret

**Seedance 2.0**, **Seedance 2.5**, **MiniMax H3 Max**, **Gemini Omni 1.2 Flash** veya **MAGI-2** seç. Modlar, süre, görüntü oranı ve referans türleri modele ve sağlayıcıya göre değişir. Örneğin Seedance 2.5 çekiminin açılışını ve bitişini yönlendirmek için iki durağan görseli ilk ve son kare olarak işaretle.

fal.ai üzerindeki H3 Max, metin/görsel/referanstan üretimin yanında Extend, Lip Sync ve Recast sunar. Omni kaynak videoyu düzenleyebilir, uzatabilir veya çözünürlüğünü yükseltebilir. EvoLink'teki MAGI-2 referans modunda yalnızca sesle de çalışır. [Video rotalarını karşılaştır →](models.md#video-farkları)

<p align="center"><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4"><img src="../assets/video-preview.gif" width="640" alt="Gerçek üretilmiş video önizlemesi: kostümlü iki karakter oyuncak makinesindeki peluşların arasından çıkıyor" /></a></p>

<p align="center"><strong><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4">15 saniyelik gerçek klibi indir (MP4) →</a></strong><br /><sub>Sahibinin hesabından daha önce üretilmiş MiniMax H3 klibi. Küçültülmüş, sessiz dokümantasyon önizlemesi; güncel Max modelinin yeni bir testi değildir.</sub></p>

<details>
<summary>Gerçek video oynatıcısını ve kayıtlı üretim bilgilerini gör</summary>

<p><img src="../assets/video-real.jpg" width="1000" alt="Gerçek galeri video oynatıcısı: seçili klip, prompt, kayıtlı model, süre ve kalite" /></p>

</details>

## Tüm projeni bir arada tut

| Özellik | Ne işe yarar? |
| --- | --- |
| **Görsel üretimi** | Nano Banana Pro / 2.1, GPT Image 2.5 / 2.6 Sunburst ve Seedream 5.5. Seedream bir kaynak görselden katman da çıkarabilir. |
| **Referanslar ve `@` etiketleri** | Görsel yükle veya yeniden kullan; kimlik, nesne, stil veya sahne rolü ver. Referans eklemek alan editini zorlamaz. |
| **People** | Aynı kişinin kimlik fotoğraflarını grupla; birden fazla fotoğraf hâlâ tek kişiyi temsil eder. |
| **Referans kütüphanesi ve şablonlar** | Kaynakları, kayıtlı prompt ve ayar kombinasyonlarını farklı projelerde yeniden kullan. |
| **Re-create ve Variation** | Bir sonucun prompt ve ayarlarını geri yükle veya yeni varyasyon keşfet. |
| **Galeri düzeni** | İç içe klasör, favori, arama, görsel/video filtresi, grid yoğunluğu, çoklu seçim ve klasörler arası taşıma. |
| **Görüntüleyici ve karşılaştırma** | Doğal görsel oranı, zoom/kaydırma, yan yana görsel karşılaştırması ve kaynak/edit sliderı. Oklarla gezinme, **Shift+B** ile Details açma/kapatma, mobilde kaydırarak gezinme ve kapatma. |
| **İşler ve geçmiş** | İlerleme, bildirimler, tamamlanan sonuçlar ve kurtarılabilen iş bilgileri; webde OpenAI görsel işleri kalıcı kuyruk kullanır. |
| **Üretim detayları** | Mevcut prompt, referans, boyut, model, kalite, maliyet, süre, hazırlama modeli/düşünme seviyesi ve kayıtlı edit katmanları/kaynağı. Eski kayıtlarda bazı alanlar bulunmayabilir. |
| **İndirme ve paylaşım** | Görsel/video indir. Web alanında tamamlanmış görselleri görmek ve indirmek için süreli herkese açık klasör bağlantıları da oluşturulabilir. |
| **Çalışma alanı yönetimi** | Webde hesap erişimi ve sahip/yönetici kontrolleri; bağımsız masaüstü uygulamasında yerel çalışma alanı. |

[Görselli kullanım rehberini aç →](guide.md)

## Başlangıç

| Cihazın | Bugün sunulan sürüm | Buradan başla |
| --- | --- | --- |
| Apple Silicon işlemcili Mac | Bağımsız uygulama, macOS 13.5+ | [İndir](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-arm64.zip) · [Kurulum rehberi](desktop.md) |
| Intel işlemcili Mac | Bağımsız uygulama, macOS 13.5+ | [İndir](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-x64.zip) · [Kurulum rehberi](desktop.md) |
| Windows 10/11, 64-bit Intel/AMD | Bağımsız taşınabilir uygulama | [İndir](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-windows-x64.zip) · [Kurulum rehberi](desktop.md#windows-indir-ve-aç) |
| Diğer bilgisayarlar, telefon ve tablet | Tarayıcı üzerinden web sürümü | Kurulmuş web adresini aç; erişimi ve servis anahtarlarını web alanının sahibi yönetir. |

**Masaüstünde hızlı başlangıç:** indir → zip'i ayıkla → aç (Mac'te önce Uygulamalar'a taşı) → **Provider keys** → modelin anahtarını gir → üret. Bağımsız uygulamada **Supabase, Vercel, Google ile giriş veya ayrıca Node kurulumu gerekmez**. Galeri bilgisayarında; anahtarlar Mac'te Anahtar Zinciri'nde, Windows'ta Credential Manager'da tutulur. Üretim sürerken uygulamayı açık tut; pencereyi küçültebilirsin. [İlk açılış izinleri, güncelleme ve yedekleme →](desktop.md)

## Modeller ve API anahtarları

**Güncel kaynak kodda `FAL_KEY`, MAGI-2 dışında varsayılan görsel, yaratıcı metin ve video rotalarına yeter.** MAGI-2, `EVOLINK_API_KEY` kullanır. Her sağlayıcıda hesap açman gerekmez. İndirilen masaüstü paketinde, daha sonraki kaynak kod değişiklikleri değil, yayımlanan sürümün model listesi bulunur.

**AI settings → Provider routing** bölümünde anahtarına uygun bir sağlayıcıyı sabitle, gönderimden önce yapılandırılmış ilk rotayı seçmek için **Auto** kullan veya modelde yeni işleri **Off** ile kapat. Modele göre doğrudan OpenAI, Anthropic ve Google Gemini anahtarları, OpenRouter ve masaüstünde Codex girişi de kullanılabilir. Kabul edilmiş iş kendi sağlayıcısında kalır; sonucu belirsiz ücretli istek başka servise gönderilmez.

YouTube araması `YOUTUBE_API_KEY` gerektirir. Görüntüleri okumak için yaratıcı brief'i yazan sağlayıcıdan bağımsız olarak doğrudan `GEMINI_API_KEY` gerekir. [13 model, rota öncelikleri, anahtar bağlantıları ve örnekler →](models.md)

## Hangi sistemlerle çalışıyor?

Ortak arayüz **React + TypeScript + Vite** ile hazırlanır. Mac kabuğu **AppKit + WKWebView** kullanır; kendi **Node.js** sunucusunu taşır, verileri **SQLite + yerel dosyalara**, anahtarları **Anahtar Zinciri'ne** kaydeder, **Sparkle** ile güncellenir. Windows kabuğu **WinForms + WebView2**, aynı Node/SQLite çalışma alanı ve **Windows Credential Manager** kullanır. Web sürümü **Vercel Functions / Queues / Cron** ve **Supabase Postgres / Auth / özel Storage** kullanır; Google ile giriş yapılır.

İşlemde kullanılan prompt ve referanslar ilgili sağlayıcıya gönderilir. Masaüstü ve web galerileri ayrıdır; Masaüstü uygulamaları otomatik bulut senkronizasyonu yapmaz. [Veri sınırları](../../SECURITY.md) · [Mimari ve geliştirici kurulumu](development.md) · [Yayın prosedürü](../RELEASING.md)

<a id="web-kurulumu"></a>

## Kendi web alanını kur

Windows, Mac, mobil ve ekibin için tarayıcıdan açılan bir alan mı istiyorsun? Repoyu kendi GitHub hesabına kopyala, kendi Supabase projeni oluştur, Vercel'e deploy et. Supabase bilgilerini ve servis anahtarlarını **sunucu ortam değişkenlerine** ekle, Google girişini ayarla ve ilk yöneticiyi etkinleştir. Dakikalık Cron için bunu destekleyen Vercel planı gerekir; yalnızca arayüzü yüklemek yetmez.

Rehberde terminal gerektirmeyen SQL Editor yolu, değişken tablosu, kontrol adımları ve hata çözümleri bulunur. Hazır bir Banana Studio veritabanı veya kişisel hesap dahil değildir.

**[Adım adım web kurulum rehberini aç →](deploy.md)**

<p align="center"><sub><a href="../../LICENSE">MIT</a> · <a href="../../SECURITY.md">Güvenlik</a> · <a href="development.md">Katkıda bulun</a> · <a href="../THIRD_PARTY_NOTICES.md">Üçüncü taraf bildirimleri</a> · <a href="../../README.md">English</a></sub></p>
