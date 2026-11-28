# Modeller, sağlayıcılar ve API anahtarları

[Ana sayfa](README.md) · [English](../en/models.md) · [Mac kurulumu](desktop.md) · [Web kurulumu](deploy.md)

**Model** içeriği üretir. **Sağlayıcı** isteği alır ve hesabından ücretlendirir. **API anahtarı** Banana Studio'nun o sağlayıcıyı kullanmasını sağlar. Modelin adını tanıyor olman, her anahtarın onu açacağı anlamına gelmez.

Tablolar uygulamanın kullandığı bağlantıları gösterir. Model erişimi, fiyat ve kotalar sağlayıcı tarafında değişebilir. Paket kredi veya önceden ayarlanmış özel hesap içermez.

## Bütün servislerde hesap açman gerekmez

Masaüstünde kullandığın anahtarları **Provider keys** bölümüne ekle. **AI settings → Provider routing** içinde her model, birden fazla sağlayıcıda olsa bile bir kez görünür. Yeni işlerde varsayılan sağlayıcı **fal.ai**'dır; tek istisna **EvoLink** kullanan **MAGI-2**'dir.

- **Belirli bir sağlayıcı:** yalnızca onu kullanır. Anahtar eksikse anahtarı ekle veya ayarı değiştir; uygulama başka hesabı denemez.
- **Auto:** istek gönderilmeden önce tablodaki sırayla, yapılandırılmış ilk rotayı seçer. Auto seçeneğini ayrıca seçmen gerekir.
- **Off:** modeli yeni üretimlere kapatır. Geçmiş silinmez, kabul edilmiş işler iptal edilmez.

Kabul edilen iş, sağlayıcısı ve görev kimliğiyle saklanır. Rotayı değiştirmek, modeli kapatmak veya uygulamayı yeniden başlatmak bu işi başka sağlayıcıya taşımaz. Kurtarma için ilk sağlayıcının anahtarı erişilebilir olmalıdır. Sonucu belirsiz kalan istek otomatik olarak yeniden gönderilmez. Tercihler masaüstünde yerel çalışma alanına, webde oturum açmış hesabına kaydedilir.

**Web çalışma alanı kuralı:** Alan sahibi veya yönetici, **AI settings → Provider routing → Workspace policy** bölümünde herkes için bir sağlayıcı sabitleyebilir veya modeli **Off** ile kapatabilir. Sabitlenen rota kişisel sağlayıcı seçiminden önce gelir; kullanıcı yine de kendi ayarında **Off** seçerek modeli kullanmayabilir. **Let people choose** kuralı kaldırır ve her üyenin kayıtlı seçimini geri getirir. Değişiklik yalnızca yeni gönderimleri etkiler. Masaüstü çalışma alanı kendi yerel ayarlarını kullanır; webdeki kuralı devralmaz.

## Modeller ve bağlantılar

| Tür | Model | Auto sırası (ilk sağlayıcı aynı zamanda varsayılandır) |
| --- | --- | --- |
| Görsel | Nano Banana Pro | fal.ai → Google Gemini → OpenRouter |
| Görsel | Nano Banana 2.1 | fal.ai → Google Gemini → OpenRouter |
| Görsel | GPT Image 2.5 Sunburst | fal.ai → OpenAI → OpenRouter → [ChatGPT aboneliği (Codex)](#chatgpt-aboneliğiyle-gpt-image) |
| Görsel | GPT Image 2.6 Sunburst | fal.ai → OpenAI |
| Görsel | Seedream 5.5 | fal.ai |
| Video | Seedance 2.0 | fal.ai → EvoLink → OpenRouter |
| Video | Seedance 2.5 | fal.ai → EvoLink → OpenRouter |
| Video | MiniMax H3 Max | fal.ai → EvoLink |
| Video | Gemini Omni 1.2 Flash | fal.ai |
| Video | MAGI-2 | EvoLink |
| Metin | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview) | fal.ai → EvoLink → Anthropic → OpenRouter |
| Metin | Gemini 4 Hydrogen | fal.ai → EvoLink → Google Gemini → OpenRouter |
| Metin | GPT-6.2 Sol | fal.ai → EvoLink → OpenAI → OpenRouter |

### ChatGPT aboneliğiyle GPT Image

Mac ve Windows'ta GPT Image **2.5**, API anahtarı olmadan resmî [Codex CLI](https://developers.openai.com/codex/cli) üzerinden çalışabilir. Codex'i kur, `codex login` komutuyla **Sign in with ChatGPT** seçeneğini kullan, ardından model için **ChatGPT plan (Codex)** rotasını seç. Banana Studio senin `codex` programını sınırlı ortam değişkenleriyle salt okunur bir sandbox'ta çalıştırır, prompt'u stdin üzerinden gönderir ve kaydedilen görseli okur. Yalnızca giriş türünü kontrol eder; Codex token'larını okumaz, iletmez ve sağlayıcı anahtarlarını sürece aktarmaz. Codex `PATH` üzerinde değilse `CODEX_BIN` ayarla; Windows'ta uygulama `codex.exe` arar.

Görseller API faturası yerine ChatGPT aboneliğinin Codex kullanım limitinden düşer. Her görsel yaklaşık bir dakika sürer, Codex istenen orana en yakın desteklenen tuvali seçer, kalite/moderasyon ayarları iletilmez. Korumalı editlerde yine yalnızca seçili alan birleştirilir; Codex farklı oranda görsel döndürürse sonuç reddedilir. Web kurulumları bu rotayı kullanamaz. Codex her üretilen görselin bir kopyasını `CODEX_HOME` altında (varsayılan `~/.codex`) kendisi de saklar; Banana Studio bu kopyayı silmez.

### Görsel üretimi, düzenleme ve katmanlar

Referans eklemek yeni görsele yön verir; **Edit area** seçeneğini kendiliğinden açmaz. Kaynağın kalanını korumak için düzenlenecek alanı açıkça seç. Uygulama yalnızca o alanı orijinal görsele yerleştirir; en-boy oranı uyuşmayan sonucu reddeder. Alan seçmemiş olsan bile sağlayıcının referans kabul eden API'si “edit” adını taşıyabilir.

**Seedream 5.5** ile görsel üretebilir, sırasını belirlediğin en fazla on referans görselle düzenleme yapabilir veya **Layerize** ile tek bir kaynaktan katman çıkarabilirsin. Katman sayısına taban görsel de dahildir. Şeffaf çıktı için PNG gerekir. Katman çıkarma ayrı görseller üretir; kaynak üzerinde korumalı alan düzenlemesi yapmaz.

## Video farkları

| Model | Sağlayıcıya veya işleme göre farklar |
| --- | --- |
| **Seedance 2.0** | Tüm rotalarda metin, ilk/son kare ve görsel referansları kullanılabilir. fal.ai ile EvoLink video ve ses referanslarını da kabul eder. Sabit süre: 4–15 saniye. |
| **Seedance 2.5** | fal.ai **US**, EvoLink **Relaxed** rotasını kullanır. İkisinde de üretimin yanı sıra Edit ve Extend bulunur. fal'daki 480p taslak, nihai 4K çıktı değildir. OpenRouter metin, ilk/son kare ve en fazla dokuz görsel referans kabul eder; 480p/720p ve sabit 4–30 saniye seç. OpenRouter'da video/ses referansı, Edit veya Extend yoktur. |
| **MiniMax H3 Max** | EvoLink metinden, ilk/son kareden veya referanstan üretimi 480p/768p ve 5–15 saniyede destekler. Extend, Lip Sync veya Recast için fal.ai seç. |
| **Gemini Omni 1.2 Flash** | Yalnızca fal.ai. Metinden, karelerden veya referanslardan üretir. Edit, Extend ve Upscale kaynak video üzerinde çalışır; Upscale prompt almadan çözünürlüğü artırır. |
| **MAGI-2** | Yalnızca EvoLink. 1080p, 4–30 saniye üretir. Görsel modu ilk kareyi ve isteğe bağlı son kareyi alır. Referans modu en fazla on görsel, beş video ve beş ses klibi kabul eder; yalnızca ses de kullanılabilir. |

Bazı referans videolarının hazırlanması ayrı bir fal.ai isteği gerektirir. Üretimi başka sağlayıcı yapsa da bu adım için `FAL_KEY` gerekir. Fiyat, izin ve sınırları her sağlayıcı kendisi belirler. Bir seçenek desteklenmiyorsa uygulama başka bir ücretli modele veya sağlayıcıya geçmez.

## Yaratıcı metin ve YouTube görüntülerinin analizi

Enhance, Brainstorm ve varyasyonlar seçilen yaratıcı metin modelini ve onun sağlayıcısını kullanır. fal.ai üzerinden metin üretirken [OpenRouter geçidi](https://fal.ai/models/openrouter/router/openai/v1/chat/completions/api) `FAL_KEY` ile çalışır; ayrıca OpenRouter anahtarı gerekmez. Düşünme seviyesi AI settings içindedir.

**Gerçek YouTube görüntülerini okumak** ayrı bir işlemdir: Gemini 4 Hydrogen açık olmalı ve doğrudan **`GEMINI_API_KEY`** tanımlanmalıdır. Yaratıcı metin için kullandığın fal.ai, EvoLink veya OpenRouter anahtarı bunun yerini tutmaz. Seçilen yaratıcı model, videoyu kendisi izlemeden Gemini'nin gözlemlerinden brief hazırlayabilir. Arama ve video bilgileri için **`YOUTUBE_API_KEY`** (YouTube Data API v3) gerekir. Google OAuth bilgileri yalnızca webde oturum açmak içindir.

## Anahtar oluştur

Sağlayıcının panelinde bir anahtar oluştur ve masaüstünde ilgili alana kaydet. Web kurulumunda, kurulum sahibi karşılık gelen **sunucu** ortam değişkenini tanımlar ve uygulamayı yeniden dağıtır. Yalnızca kullanacağın sağlayıcıları ve özellikleri yapılandır.

| Sağlayıcı | Sunucu değişkeni | Başlangıç |
| --- | --- | --- |
| fal.ai | `FAL_KEY` | [Anahtar paneli](https://fal.ai/dashboard/keys) |
| EvoLink | `EVOLINK_API_KEY` | [EvoLink hesabı](https://evolink.ai) |
| OpenAI | `OPENAI_API_KEY` | [API anahtarları](https://platform.openai.com/api-keys) |
| OpenRouter | `OPENROUTER_API_KEY` | [API anahtarları](https://openrouter.ai/settings/keys) |
| Anthropic | `ANTHROPIC_API_KEY` | [Claude Console API anahtarları](https://console.anthropic.com/settings/keys) |
| Google Gemini | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| YouTube Data API | `YOUTUBE_API_KEY` | [API'yi etkinleştir ve kimlik bilgisi oluştur](https://developers.google.com/youtube/data/getting-started) |

YouTube için kendi Google Cloud projeni oluştur/seç, **YouTube Data API v3** servisini etkinleştir ve bu projeye ait API anahtarı oluştur. Gemini anahtarı, bu servisin etkinleştirilmesi ve kotasının yerine geçmez. API kullanımı ile tüketici sohbet abonelikleri ayrı ürünlerdir; sohbet aboneliğinin API isteklerini karşıladığını varsayma.

## Örnek kurulumlar

| İsteğin | Ekle ve seç |
| --- | --- |
| Görsel, yaratıcı metin ve desteklenen videolar için tek fatura | `FAL_KEY` ekle; modelleri fal.ai'da bırak. MAGI-2 ve görüntü analizi için başka sağlayıcılar gerekir. |
| Yalnızca MAGI-2 | `EVOLINK_API_KEY` ekle; MAGI-2'yi EvoLink'te bırak. |
| Doğrudan Gemini ile Nano görsel ve Enhance / Brainstorm | `GEMINI_API_KEY` ekle; Nano ve Gemini 4 Hydrogen için Google Gemini'yi seç. |
| Doğrudan GPT görsel ve GPT metin | `OPENAI_API_KEY` ekle; Sunburst ve GPT-6.2 Sol için OpenAI'ı seç. |
| YouTube analizi ve yeni kapak fikirleri | Arama için YouTube Data API'yi, görüntüler için doğrudan Gemini'yi yapılandır; ardından metin ve görsel rotalarını seç. |
| OpenRouter gibi desteklenen alternatif bir sağlayıcıyla devam | Anahtarını koruyup sağlayıcıyı sabitle veya yapılandırılmış ilk rotayı kullanmak için açıkça Auto seç. |

## Maliyet ve anahtar güvenliği

Uygulamadaki tahmin sağlayıcı bakiyesi veya fatura değildir. Metin düşünmesi, referanslar, kalite, video süresi ve ön işlem ayrıca maliyete etki edebilir. Harcama sınırlarını sağlayıcılardan belirle, kullanım panellerini takip et.

Anahtarlar masaüstünde **macOS Anahtar Zinciri / Windows Credential Manager'a**, webde **sunucu ortam değişkenlerine** aittir. Prompt, ekran görüntüsü, GitHub issue'su, public repo veya `VITE_*` değişkenine koyma. Üretim için yönetici seviyesinde faturalama anahtarları gerekmez. `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY` ve `OPENAI_PROJECT_ID`, web sürümünün isteğe bağlı faturalama raporu ayarlarıdır.

Geliştiriciler için doğruluk kaynağı: [sağlayıcı kaydı](../../src/lib/providers.ts), [model seçenekleri](../../src/types.ts), [görsel yönlendirme](../../src/services/geminiService.ts), [video yönlendirme](../../src/services/runwayService.ts), [YouTube analizi](../../src/services/youtubeBriefService.ts), [yerel anahtar alanları](../../desktop/macos/Sources/BananaStudio/KeyVault.swift).
