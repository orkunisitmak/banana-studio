# Modeller, sağlayıcılar ve API anahtarları

[Ana sayfa](README.md) · [English](../en/models.md) · [Mac kurulumu](desktop.md) · [Web kurulumu](deploy.md)

**Model** içeriği üretir. **Sağlayıcı** isteği alır ve hesabından ücretlendirir. **API anahtarı** Banana Studio'nun o sağlayıcıyı kullanmasını sağlar. Modelin adını tanıyor olman, her anahtarın onu açacağı anlamına gelmez.

Tablolar uygulamanın kullandığı bağlantıları gösterir. Model erişimi, fiyat ve kotalar sağlayıcı tarafında değişebilir. Paket kredi veya önceden ayarlanmış özel hesap içermez.

## Bütün servislerde hesap açman gerekmez

Mac veya Windows'ta **Provider keys** bölümüne kullanacağın **bir veya birkaç** anahtarı ekle. **AI settings → Provider routing** içinde model başına **Auto** veya belirli sağlayıcı seç. Üretim barında ve edit prompt kutusunda da seçim görünür. Auto, tabloda soldan sağa doğru tanımlı anahtarı olan ilk bağlantıyı **istek gönderilmeden önce** seçer. Eksik anahtarlar zorunlu kurulum adımı değildir.

Kabul edilen görsel işi, sayfa yenilense veya uygulama yeniden açılsa da sağlayıcısını korur. Ayar değişikliği yeni işleri etkiler. Anahtarı kaldırmak işi başka serviste tekrar başlatmaz; kurtarmak için ilk sağlayıcının anahtarını geri ekle. Sonucu belirsiz ücretli istekler otomatik tekrarlanmaz. Yönlendirme tercihleri masaüstünde yerel veritabanında, webde bu tarayıcıda hesap başına saklanır.

## Modeller ve bağlantılar

| Model / özellik | Auto önceliği | Uygun anahtarlardan biri |
| --- | --- | --- |
| GPT Image 2.5 | OpenAI → OpenRouter → fal.ai → ChatGPT aboneliği (Codex) | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `FAL_KEY` ya da [Codex girişi](#chatgpt-aboneliğiyle-gpt-image) |
| Nano Banana Pro / 2.1 | fal.ai → Google Gemini → OpenRouter | `FAL_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Opus 5.5 — varsayılan yaratıcı model, Medium | OpenRouter | `OPENROUTER_API_KEY` |
| GPT-6.1 Sol — Enhance, Brainstorm, varyasyon | OpenAI → OpenRouter | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` |
| Gemini 3.8 Flash — metin ve video analizi | Google Gemini → OpenRouter | `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Seedance 2.0 / 2.5 | EvoLink → fal.ai → OpenRouter | `EVOLINK_API_KEY` / `FAL_KEY` / `OPENROUTER_API_KEY` |
| H3 Max — Text/Image/Reference to Video, Extend, Lip Sync, Recast | fal.ai | `FAL_KEY` |
| Gerektiğinde video referansı ön işlemi | fal.ai | `FAL_KEY` |
| YouTube arama / kanal ve video bilgileri | YouTube Data API v3 | `YOUTUBE_API_KEY` |

### ChatGPT aboneliğiyle GPT Image

Mac ve Windows'ta GPT Image 2.5, ChatGPT hesabınla giriş yapılmış resmi [Codex CLI](https://developers.openai.com/codex/cli) üzerinden API anahtarı olmadan çalışabilir. Codex'i kur, `codex login` çalıştırıp **Sign in with ChatGPT** seç, sonra Provider routing'de **ChatGPT plan (Codex)** seç ya da GPT Image anahtarı yoksa Auto'da bırak. Banana Studio kendi `codex` programını salt okunur bir sandbox'ta başlatır, prompt'u stdin ile gönderir ve kaydedilen görseli okur. Codex token'larını hiçbir zaman okumaz veya iletmez; rotanın uygun görünmesi için `~/.codex/auth.json` içindeki yalnızca giriş türü kontrol edilir. Codex alışılmadık bir yerdeyse `CODEX_BIN` değişkenine çalıştırılabilir dosyanın tam yolunu yaz; Windows'ta uygulama `PATH` üzerinde `codex.exe` arar. Codex en az ortam değişkeniyle çalışır, API anahtarların ona hiç aktarılmaz.

Görseller API faturası yerine ChatGPT aboneliğinin Codex kullanım limitinden düşer. Her görsel yaklaşık bir dakika sürer, Codex istenen orana en yakın desteklenen tuvali seçer, kalite/moderasyon ayarları iletilmez. Korumalı editlerde yine yalnızca seçili alan birleştirilir; Codex farklı oranda görsel döndürürse sonuç reddedilir. Web kurulumları bu rotayı kullanamaz. Codex her üretilen görselin bir kopyasını `CODEX_HOME` altında (varsayılan `~/.codex`) kendisi de saklar; Banana Studio bu kopyayı silmez.

Üç görsel sağlayıcısı da referanslı yeni üretimi destekler. Referans eklemek kendiliğinden korumalı editi açmaz: bunun için **Edit area** seç. Son seçili alan kaynak görsele yerleştirilir; dışındaki pikseller sağlayıcıdan bağımsız olarak korunur. Nano'nun çözünürlük katmanlarından gelen çıktı, oranı kaynakla uyuşuyorsa birleştirmeden önce kaynak boyutuna ölçeklenebilir; farklı oran reddedilir. Sağlayıcının referans görsel kabul eden API adı “edit” olabilir; bu, uygulamada otomatik alan editi anlamına gelmez.

Düşünme seviyesi AI settings'ten seçilir. Yalnızca fal.ai anahtarı Enhance/Brainstorm açmaz; artık desteklenmeyen Any LLM bağlantısını kullanmıyoruz. Anthropic anahtarı OpenRouter anahtarı değildir. Anahtarın model erişimi ve API bakiyesi bulunmalıdır.

## Video farkları

| İşlem | EvoLink | fal.ai | Bu uygulamada OpenRouter |
| --- | --- | --- | --- |
| Metinden video | Var | Var | Var |
| First frame / first + last frame | Var | Var | Var |
| Görsel referansları | Var | Var | Var, en fazla 9 |
| Video / ses referansları | Var | Var | Açık değil |
| Seedance 2.5 Edit / Extend | Var | Var | Açık değil |
| Seedance 2.5 Auto süre | Var | Var | Sabit 4–30 saniye |
| Seedance 2.5 çözünürlük | 480p / 720p / 1080p | 480p / 720p / 1080p | 480p / 720p |
| Seedance 2.0 sabit süre | 4–15 saniye | 4–15 saniye | 4–15 saniye |

**Seedance 2.5 Relaxed**, mevcut EvoLink bağlantısının özelliğidir. fal.ai ve OpenRouter standart Seedance 2.5 kullanır; fiyatları, izinleri ve limitleri kendilerine aittir. H3 Max yalnızca fal.ai kullanır; benzer isimli başka MiniMax modeliyle değiştirilmez. Desteklenmeyen seçenekler üretimden önce kontrol edilir; başka modele sessiz geçiş yapılmaz.

Video analizi gerçek YouTube görüntüsünü doğrudan Gemini veya OpenRouter'ın Google AI Studio bağlantısıyla okur. Opus/GPT bu gözlemlerden yaratıcı brief hazırlayabilir; videoyu kendileri izlemiş gibi gösterilmezler. YouTube arama/bilgileri için ayrı **YouTube Data API v3** anahtarı gerekir. Google OAuth bilgileri farklıdır ve yalnızca web girişinde kullanılır.

Resmî bağlantılar: [OpenRouter görsel](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [video üretimi](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), [video okuma](https://openrouter.ai/docs/guides/overview/multimodal/videos), [fal Seedance 2.5](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api), [fal GPT Image 2.5](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api).

## Anahtar oluştur

Sağlayıcıda hesap aç, anahtar panelinden yeni anahtar oluştur ve Mac veya Windows'ta **Provider keys** içindeki doğru kutuya yapıştır. Web sürümünde kurulumu yapan kişi aynı değeri Vercel'de yukarıdaki isimle ortam değişkenine kaydeder, ardından yeniden deploy eder.

| Sağlayıcı | Başlangıç | Resmî açıklama |
| --- | --- | --- |
| OpenAI | [API anahtarları](https://platform.openai.com/api-keys) | [OpenAI API başlangıç rehberi](https://developers.openai.com/api/docs/quickstart) |
| OpenRouter | [API anahtarları](https://openrouter.ai/settings/keys) | [Başlangıç rehberi](https://openrouter.ai/docs/quickstart) |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | [Gemini API anahtarları](https://ai.google.dev/gemini-api/docs/api-key) |
| fal.ai | [Anahtar paneli](https://fal.ai/dashboard/keys) | [fal başlangıç rehberi](https://fal.ai/docs/documentation/quickstart) |
| EvoLink | [EvoLink hesabı](https://evolink.ai) | [API dokümanları](https://docs.evolink.ai) |
| YouTube Data API | [Google Cloud kimlik bilgileri](https://console.cloud.google.com/apis/credentials) | [YouTube Data API v3 etkinleştirme ve kimlik bilgileri](https://developers.google.com/youtube/data/getting-started) |

YouTube için kendi Google Cloud projeni oluştur/seç, **YouTube Data API v3** servisini etkinleştir ve bu projeye ait API anahtarı oluştur. Gemini anahtarı, bu servisin etkinleştirilmesi ve kotasının yerine geçmez. API kullanımı ile tüketici sohbet abonelikleri ayrı ürünlerdir; sohbet aboneliğinin API isteklerini karşıladığını varsayma.

## Örnek kurulumlar

| İsteğin | Ekle ve seç |
| --- | --- |
| Görsel + metin + desteklenen video için tek AI hesabı | OpenRouter; GPT/Nano görsel, Opus/GPT/Gemini metin, desteklenen Seedance işlemleri |
| Promptu kendim yazıp görsel/video üretmek | fal.ai; GPT/Nano, Seedance veya H3 Max; metin anahtarı gerekmez |
| Nano görsel + Gemini Enhance/Brainstorm | Gemini; metin modeli olarak Gemini 3.8 Flash seç |
| Doğrudan GPT görsel + GPT metin | OpenAI; GPT Image 2.5 + GPT-6.1 Sol |
| YouTube analizi ve yeni kapak fikirleri | OpenRouter + YouTube Data API; desteklenen görsel bağlantısını veya ek sağlayıcını kullan |
| Mevcut ayrı servisli kurulum | Anahtarların kalabilir; Auto mevcut ana sağlayıcı varsa onu seçer, tercihini ayrıca sabitleyebilirsin |

## Maliyet ve anahtar güvenliği

Uygulamadaki tahmin sağlayıcı bakiyesi veya fatura değildir. Metin düşünmesi, referanslar, kalite, video süresi ve ön işlem ayrıca maliyete etki edebilir. Harcama sınırlarını sağlayıcılardan belirle, kullanım panellerini takip et.

Anahtarlar masaüstünde **macOS Anahtar Zinciri / Windows Credential Manager'a**, webde **sunucu ortam değişkenlerine** aittir. Prompt, ekran görüntüsü, GitHub issue'su, public repo veya `VITE_*` değişkenine koyma. Üretim için yönetici seviyesinde faturalama anahtarları gerekmez. `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY` ve `OPENAI_PROJECT_ID`, web sürümünün isteğe bağlı faturalama raporu ayarlarıdır.

Geliştiriciler için doğruluk kaynağı: [sağlayıcı kaydı](../../src/lib/providers.ts), [model seçenekleri](../../src/types.ts), [görsel yönlendirme](../../src/services/geminiService.ts), [video yönlendirme](../../src/services/runwayService.ts), [YouTube analizi](../../src/services/youtubeBriefService.ts), [yerel anahtar alanları](../../desktop/macos/Sources/BananaStudio/KeyVault.swift).
