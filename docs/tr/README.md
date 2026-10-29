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

Türkçe taslaklardan da üretim açıklamaları İngilizce hazırlanır; görselde görünmesini istediğin yazılar, özel isimler ve alıntılanan diyaloglar istenen dilde kalır. **AI settings** bölümünde **Opus 5.5, GPT-6.1 Sol veya Gemini 3.8 Flash** ve düşünme seviyesini seç. Başlangıç ayarı **Opus 5.5 / Medium**. Kayıt varsa kullanılan hazırlama modeli ve düşünme seviyesi detaylarda saklanır.

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

Süre, en-boy oranı, kalite ve girdiler için modele uygun kontrolleri kullan. **Seedance 2.0 / 2.5 Relaxed** ve **MiniMax H3 Max** farklı akışlar sunar; arayüz seçili moda uygun ayarları gösterir. Seedance 2.5 first/last-frame modunda açılış ve bitişi yönlendirmek için iki durağan görsel kullanılır.

MiniMax H3 Max modları: **Text to Video Max · Image to Video Max · Reference to Video Max · Extend Video Max · Lip Sync Max · Recast**. Desteklenen modlarda görsel, video veya ses referansı ekle; Enhance ile hareket talimatını hazırla, işi takip et, sonucu oynat veya indir.

<p align="center"><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4"><img src="../assets/video-preview.gif" width="640" alt="Gerçek üretilmiş video önizlemesi: kostümlü iki karakter oyuncak makinesindeki peluşların arasından çıkıyor" /></a></p>

<p align="center"><strong><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4">15 saniyelik gerçek klibi indir (MP4) →</a></strong><br /><sub>Sahibinin hesabından daha önce üretilmiş MiniMax H3 klibi. Küçültülmüş, sessiz dokümantasyon önizlemesi; güncel Max modelinin yeni bir testi değildir.</sub></p>

<details>
<summary>Gerçek video oynatıcısını ve kayıtlı üretim bilgilerini gör</summary>

<p><img src="../assets/video-real.jpg" width="1000" alt="Gerçek galeri video oynatıcısı: seçili klip, prompt, kayıtlı model, süre ve kalite" /></p>

</details>

## Tüm projeni bir arada tut

| Özellik | Ne işe yarar? |
| --- | --- |
| **Görsel üretimi** | GPT Image 2.5, Nano Banana Pro ve Nano Banana 2.1; desteklenen modellerde oran, boyut/özel ölçü, kalite ve görsel sayısı. |
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

API anahtarı, uygulamanın ilgili yapay zekâ servisindeki hesabını kullanmasını sağlayan özel bir erişim bilgisidir. Yalnızca kullanacağın servisleri ekle. Tablo **bu uygulamanın kullandığı bağlantıları** gösterir; modelleri sunan tüm servislerin listesi değildir.

| Model veya özellik | Sağlayıcılar (Auto önceliği) | Uygun anahtarlardan biri yeterli |
| --- | --- | --- |
| GPT Image 2.5 — yeni görsel ve korumalı alan editi | OpenAI → OpenRouter → fal.ai → ChatGPT aboneliği (Codex, yalnızca masaüstü) | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `FAL_KEY` ya da anahtarsız: ChatGPT ile `codex login` |
| Nano Banana Pro / Nano Banana 2.1 | fal.ai → Google Gemini → OpenRouter | `FAL_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Claude Opus 5.5 — Enhance, Brainstorm, varyasyon ve yaratıcı brief | OpenRouter | `OPENROUTER_API_KEY` |
| GPT-6.1 Sol — metin özellikleri | OpenAI → OpenRouter | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` |
| Gemini 3.8 Flash — metin ve YouTube videosu analizi | Google Gemini → OpenRouter | `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Seedance 2.0 / 2.5 | EvoLink → fal.ai → OpenRouter (desteklenen işlemler) | `EVOLINK_API_KEY` / `FAL_KEY` / `OPENROUTER_API_KEY` |
| MiniMax H3 Max — metin/görsel/referanstan video, uzatma, lip sync ve recast | fal.ai | `FAL_KEY` |
| YouTube kanal/video araması | Google YouTube Data API v3 | `YOUTUBE_API_KEY` |

**Tek sağlayıcıyla başlayabilirsin:** **OpenRouter anahtarı** GPT/Nano görselleri, Opus/GPT/Gemini metin özellikleri, video analizi ve desteklenen Seedance işlemlerini açabilir. **fal.ai anahtarı** GPT/Nano görsel, Seedance ve H3 Max video için yeterli olabilir; Enhance/Brainstorm için ayrıca bir metin sağlayıcısı ekle. **Gemini anahtarı** Nano görsellerini ve Gemini metin/analizini açar. Bütün anahtarları girmen gerekmez. YouTube arama/bilgileri için ayrı YouTube Data API anahtarı gerekir.

Varsayılan yaratıcı model **Opus 5.5 / Medium** olarak kalır. Modeli, düşünme seviyesini ve **Auto / belirli sağlayıcı** seçimini **AI settings** üzerinden yap. Sağlayıcı üretim başlamadan belirlenir ve kayıtlı işte sabitlenir; sonucu belirsiz ücretli istek başka serviste tekrarlanmaz. Sonuçlarda kullanılan sağlayıcı görünür. Onayladığın edit alanının dışındaki kaynak pikseller her görsel bağlantısında korunur.

OpenRouter Seedance bu uygulamada metin, first/last frame ve görsel referanslarını destekler; sabit süre ve görüntü oranı gerekir, Seedance 2.5 için 480p/720p sunar. Video/ses referansı, Edit/Extend, Auto süre veya 2.5 ile 1080p için fal.ai/EvoLink seç. **Relaxed** yalnızca EvoLink bağlantısına aittir. Bazı video referansı ön işlemleri ayrıca fal.ai kullanır. [Sağlayıcı limitleri, anahtar bağlantıları ve örnekler →](models.md)

## Hangi sistemlerle çalışıyor?

Ortak arayüz **React + TypeScript + Vite** ile hazırlanır. Mac kabuğu **AppKit + WKWebView** kullanır; kendi **Node.js** sunucusunu taşır, verileri **SQLite + yerel dosyalara**, anahtarları **Anahtar Zinciri'ne** kaydeder, **Sparkle** ile güncellenir. Windows kabuğu **WinForms + WebView2**, aynı Node/SQLite çalışma alanı ve **Windows Credential Manager** kullanır. Web sürümü **Vercel Functions / Queues / Cron** ve **Supabase Postgres / Auth / özel Storage** kullanır; Google ile giriş yapılır.

İşlemde kullanılan prompt ve referanslar ilgili sağlayıcıya gönderilir. Masaüstü ve web galerileri ayrıdır; Masaüstü uygulamaları otomatik bulut senkronizasyonu yapmaz. [Veri sınırları](../../SECURITY.md) · [Mimari ve geliştirici kurulumu](development.md) · [Yayın prosedürü](../RELEASING.md)

<a id="web-kurulumu"></a>

## Kendi web alanını kur

Windows, Mac, mobil ve ekibin için tarayıcıdan açılan bir alan mı istiyorsun? Repoyu kendi GitHub hesabına kopyala, kendi Supabase projeni oluştur, Vercel'e deploy et. Supabase bilgilerini ve servis anahtarlarını **sunucu ortam değişkenlerine** ekle, Google girişini ayarla ve ilk yöneticiyi etkinleştir. Dakikalık Cron için bunu destekleyen Vercel planı gerekir; yalnızca arayüzü yüklemek yetmez.

Rehberde terminal gerektirmeyen SQL Editor yolu, değişken tablosu, kontrol adımları ve hata çözümleri bulunur. Hazır bir Banana Studio veritabanı veya kişisel hesap dahil değildir.

**[Adım adım web kurulum rehberini aç →](deploy.md)**

<p align="center"><sub><a href="../../LICENSE">MIT</a> · <a href="../../SECURITY.md">Güvenlik</a> · <a href="development.md">Katkıda bulun</a> · <a href="../THIRD_PARTY_NOTICES.md">Üçüncü taraf bildirimleri</a> · <a href="../../README.md">English</a></sub></p>
