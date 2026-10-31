# Kendi web çalışma alanını kur

[Ana sayfa](../../README.md#self-hosting) · [English](../en/deploy.md) · [Anahtarlar](models.md) · [Geliştirici rehberi](development.md)

Bu rehber, kendi web adresinde **yeni ve boş bir Banana Studio** kurar. Windows, Mac, telefon ve tabletten kullanılabilir. Proje sahibinin galerisine bağlanmaz; başka birinin hesabını, medyasını veya API anahtarını kopyalamaz.

Ana yolu tamamen tarayıcıdan takip edebilirsin. **Deploy**, uygulamayı barındırma servisinde yayımlamak demektir. **Fork**, repoyu kendi GitHub hesabına kopyalamaktır. Aşağıdaki hazır SQL veritabanının yapısını oluşturur; kendin kod yazman gerekmez.

## Başlamadan önce

| Hesap / servis | Ne için? |
| --- | --- |
| [GitHub](https://github.com) | Kaynak kodun sana ait kopyası |
| [Supabase](https://supabase.com/dashboard) | Veritabanı, Google girişi ve özel medya depolama |
| [Vercel](https://vercel.com) | Site, sunucu fonksiyonları, iş kuyruğu ve zamanlanmış iş kurtarma |
| [Google Cloud](https://console.cloud.google.com) | Google ile giriş için OAuth bilgileri |
| Seçtiğin yapay zekâ sağlayıcıları | Üretim ve metin desteği; [anahtar tablosu](models.md) |

**Barındırma gereksinimi:** [Vercel ayarı](../../vercel.json) her dakika bir kurtarma Cron'u çalıştırır. Dakikalık Cron destekleyen bir plan, şu anda Pro veya Enterprise, kullan. Hobby bu zamanlamayı reddeder. Projende Queues özelliği de kullanılabilir olmalıdır. [Cron limitleri](https://vercel.com/docs/cron-jobs/usage-and-pricing) ve [Queues](https://vercel.com/docs/queues) belgelerine bak. API, barındırma ve depolama servislerinin kendi ücretleri vardır. Kişisel Mac kullanımı için barındırma gerektirmeyen [bağımsız uygulamayı](desktop.md) seçebilirsin.

Yalnızca arayüz deploy'u başarılı olsun diye Cron veya kuyruk ayarını kaldırma. Bunlar desteklenen OpenAI görsel işi kurtarma akışının parçalarıdır.

## 1. Repoyu hesabına kopyala

[banana-studio](https://github.com/orkunisitmak/banana-studio) sayfasında **Fork** düğmesine bas, GitHub hesabını seç ve kopyayı oluştur. Kaynak kodu, `api/`, `supabase/` ve `vercel.json` dosyalarını birlikte koru.

**Kontrol:** artık adres **senin hesabın / banana-studio** gösteriyor. Vercel'e bu kopyayı bağlayacaksın.

## 2. Yeni Supabase projesi oluştur

[Supabase panelinde](https://supabase.com/dashboard) yeni proje oluştur. Organizasyonunu ve bölgeni seç, güçlü bir veritabanı parolası belirle, özel olarak sakla ve projenin hazırlanmasını bekle.

Bu uygulamaya ayrılmış boş bir proje kullan. Başlangıç SQL'i sabit adlarla tablo ve kurallar oluşturur; başka amaçla kullanılan veritabanına uygulanacak güncelleme değildir.

## 3. Tabloları ve özel medya alanını oluştur

1. [Başlangıç SQL dosyasını](../../supabase/migrations/20261019123903_banana_studio_baseline.sql) aç. GitHub'daki **Raw** veya kopyalama düğmesiyle **dosyanın tamamını** kopyala.
2. Yeni Supabase projen içinde **SQL Editor → New query** aç.
3. SQL'i yapıştır ve **Run** seç. Başlangıç dosyasını yeni projede bir kez çalıştır.
4. [supabase/migrations](../../supabase/migrations) altındaki sonraki dosyaları dosya adı sırasıyla, her birini ayrı SQL Editor sorgusunda çalıştır. Mevcut kurulumlarda yalnızca henüz uygulanmamış migration dosyalarını çalıştır; başlangıç dosyasını yeniden çalıştırma.
5. **Table Editor** bölümünde `profiles`, `generations`, `folders`, `authorized_emails` gibi tabloları kontrol et.
6. **Storage** bölümünde `media` alanının oluştuğunu ve **private / özel** olduğunu kontrol et. Migration dosyalarının oluşturduğu erişim kurallarını koru.

**Kontrol:** SQL başarıyla çalıştı, tablolar var, `media` özel. Geliştiriciler CLI migration yolunu da kullanabilir; migration geçmişini eşleştirmeden aynı şemaya iki yöntemi birden uygulama.

### Medya yükleme sınırları

Medya sınırı migration'ı her dosyayı referans video sınırıyla uyumlu **500 MiB (524.288.000 bayt)** ile sınırlar. İzin listesi olmayan bucket için `image/*`, `video/*` ve `audio/*` MIME kısıtlarını ekler; mevcut özel MIME izin listesi ve daha küçük boyut sınırı korunur. Özel izin listelerini ayrıca gözden geçir; migration bunları değiştirmez. Mevcut dosyalar değiştirilmez veya silinmez.

En büyük desteklenen videoları kabul etmek için projenin **global Storage dosya boyutu sınırı** da en az 500 MiB olmalıdır; bucket ayarı global sınırı yükseltemez. Bunu Storage Settings bölümünde ayarla. Supabase Free projelerinde üst sınır daha düşüktür; büyük videolar için uygun plan veya kendi barındırdığın Storage gerekir. [Supabase dosya sınırlarına](https://supabase.com/docs/guides/storage/uploads/file-limits) bak. Repodaki yerel Supabase ayarı 500 MiB kullanır.

Storage bu sınırları doğrudan yüklemelerde de uygular, ancak bunlar kullanıcı/çalışma alanı toplam kotası değil, dosya başına sınırlardır. MIME kısıtları bildirilen içerik türünü kontrol eder; dosyanın güvenli veya gerçekten o türde olduğunu doğrulamaz. İçerik incelemesi ve toplam depolama kotasının yerini tutmaz; toplam kullanımı ayrıca takip et. Bağımsız masaüstü dosya deposu değişmez.

## 4. Kopyanı Vercel'e bağla

Vercel'de **Add New → Project** seç, gerekirse GitHub'ı bağla ve **kendi fork'unu** içe aktar. Ayarlar:

| Ayar | Değer |
| --- | --- |
| Root directory | Repo kökü |
| Framework | Vite |
| Install command | `npm ci --ignore-scripts` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 24.x |

Repodaki Functions, Queue trigger ve Cron ayarını koru. Yalnızca statik dosya sunan bir host veya tek başına `dist/` yüklemek sunucu tarafını çalıştırmaz.

## 5. Sunucu ortam değişkenlerini gir

Ortam değişkeni, Vercel'in uygulamaya verdiği isimli bir ayardır. Kurulum ekranında veya **Project Settings → Environment Variables** bölümünde, Production ortamı için aşağıdakileri ekle. Değerleri kendi servis panellerinden al; GitHub'daki kaynak dosyaya yazma.

| Değişken | Girilecek değer | Gerekli mi? |
| --- | --- | --- |
| `SUPABASE_URL` | Projenin Connect penceresindeki URL'si | Evet |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable anahtar; eski `anon` anahtarı da kabul edilir | Evet |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase sunucu kimlik bilgisi: server secret veya eski `service_role` anahtarı; uygulamadaki değişken adı budur | Sunucunun iş ve görevleri için evet |
| `CRON_SECRET` | Parola yöneticinle ürettiğin yeni rastgele sır; tercihen en az 32 karakter | Evet |
| `OPENAI_API_KEY` | OpenAI anahtarı | GPT Image 2.5 ve/veya GPT-6.1 Sol için |
| `OPENROUTER_API_KEY` | OpenRouter anahtarı | Başlangıç yaratıcı modeli Opus 5.5 için |
| `GEMINI_API_KEY` | Google Gemini anahtarı | Gemini metin görevleri ve video analizi için |
| `FAL_KEY` | fal.ai anahtarı | Nano Banana, H3 Max ve desteklenen video ön işlemleri için |
| `EVOLINK_API_KEY` | EvoLink anahtarı | Seedance için |
| `YOUTUBE_API_KEY` | YouTube Data API v3 etkin Google Cloud projesinin anahtarı | YouTube araması için |

Supabase Connect penceresi ve **Settings → API Keys** bölümünden bilgileri al. Server secret/service-role anahtarı yalnızca sunucuda kalır. Uygulama arayüze yalnızca proje adresi ve publishable anahtarını verir. [Supabase anahtar türleri](https://supabase.com/docs/guides/getting-started/api-keys).

Panel tür seçtiriyorsa sağlayıcı anahtarları ile `CRON_SECRET` için **Secret** kullan. İsimlerin başına `VITE_` ekleme; bu önek değerleri arayüz paketine açar. Kullanmayacağın sağlayıcıyı boş bırak. [.env.example](../../.env.example) içindeki isteğe bağlı yönetici faturalama ayarları başlangıç için gerekmez. [Vercel ortam değişkenleri](https://vercel.com/docs/environment-variables).

**Deploy** seç. Son adresini not al; örneğin `https://your-workspace.vercel.app`. Daha sonra değişken değiştirirsen yeniden deploy et; yalnızca kaydetmek mevcut yayını değiştirmez. Preview veya Development da kullanacaksan bunlar için ayrı test bilgileri ayarla.

**Kontrol:** Vercel adresinde uygulama açılıyor. **Workspace setup is required** görürsen Supabase URL/public anahtarını kontrol et ve devam etmeden yeniden deploy et.

## 6. Google girişini bağla

1. Supabase **Authentication** bölümünde Google sağlayıcısını aç, projenin callback URL'sini kopyala.
2. Google Cloud'da OAuth izin ekranını hazırla; **Web application** türünde OAuth client oluştur.
3. Vercel uygulama adresini JavaScript origin, Supabase callback'ini redirect URI olarak ekle.
4. Client ID ve client secret değerlerini Supabase Google sağlayıcısına gir, etkinleştir.
5. Supabase Auth URL ayarlarında Vercel adresini Site URL yap ve uygulama dönüş adresine izin ver. Girişten sonra uygulama kendi origin adresine döner.
6. Google izin uygulaması test modundaysa giriş yapacak hesabını test kullanıcısı ekle.

Burada **origin**, sayfa yolu olmadan sitenin başlangıç adresidir; örneğin `https://your-workspace.vercel.app`. Örneği aynen kopyalama, kendi adresini kullan:

| Alan | Girilecek değer |
| --- | --- |
| Google: authorized JavaScript origins | Vercel site adresin |
| Google: authorized redirect URIs | Vercel adresin değil, Supabase Google sağlayıcısından kopyaladığın callback |
| Supabase: Site URL | Vercel site adresin |
| Supabase: Redirect URLs | Uygulamanın dönüş için kullandığı Vercel origin adresinin aynısı; sonuna `/` eklenmiş biçimini de ekle |

Güncel panel adımları için [Supabase Google rehberi](https://supabase.com/docs/guides/auth/social-login/auth-google). OAuth bilgileri Gemini/YouTube API anahtarlarından ayrıdır; public arayüz koduna yazılmaz.

**Kontrol:** sitede Google ile giriş yapabiliyorsun. Bu aşamada uygulama erişimi hâlâ reddedilebilir; sıradaki adım ilk sahibini yetkilendirir.

## 7. Yönetici hesabını etkinleştir

1. Kendi Google hesabınla siteye **bir kez giriş yap**; Supabase kullanıcıyı ve profilini oluştursun.
2. Supabase **Authentication → Users** bölümünde hesabın bulunduğunu kontrol et.
3. [bootstrap-owner.sql](../../scripts/bootstrap-owner.sql) dosyasını **yeni SQL Editor sorgusuna** kopyala. Yalnızca `replace-me@example.invalid` yerine doğrulanmış, küçük harfli kendi e-posta adresini yaz.
4. **Kendi** Supabase projenin SQL Editor'ünde çalıştır. E-postanı içeren değiştirilmiş dosyayı repoya kaydetme.
5. Sayfayı yenile/yeniden giriş yap. Yönetici erişimin açılmış olmalı. Diğer kullanıcıları uygulamanın yönetim kontrollerinden davet et.

Script, örnek adresi ve doğrulanmamış/bulunmayan hesapları özellikle reddeder. Kayıt olmak tek başına kimseyi yönetici yapmaz.

**Kontrol:** galeri ve yönetim kontrolleri açılır. Davet edilmemiş hesap hâlâ uygulamaya erişemez.

## 8. Uçtan uca kontrol et

1. **AI settings** bölümünde anahtarını girdiğin metin sağlayıcısını seç. Başlangıçtaki Opus 5.5 / Medium, OpenRouter ister.
2. Ayarladığın görsel modelini seç; örneğin OpenAI anahtarıyla GPT Image 2.5.
3. Kendi promptunla tek bir test görseli gönder. Bu gerçek sağlayıcı isteğidir, bakiyenden kullanım yapar.
4. Sonucun tamamlandığını, sayfayı yenileyince galeride kaldığını ve indirildiğini doğrula.
5. Vercel'de `vercel.json` içindeki `banana-image-jobs` kuyruk tetikleyicisinin ve `/api/image-job-sweep` Cron'unun göründüğünü kontrol et.
6. YouTube kullanacaksan [özellik tablosundaki](models.md#video-ve-youtube) tüm anahtarları ekle; arama ve analizi ayrı dene.

Web alanın artık adresinden Windows, Mac ve mobil tarayıcılarla kullanılabilir. Bağımsız masaüstü veritabanından ayrıdır. Alan sahibi olarak servis kullanımını, depolamayı, yedekleri ve barındırma limitlerini takip et.

## Sorun giderme

| Gördüğün durum | Kontrol / sonraki adım |
| --- | --- |
| Deploy Cron zamanlamasını reddediyor | Dakikalık Cron destekleyen Vercel planı kullan. Repodaki ayar Hobby ile uyumlu değil. |
| “Workspace setup is required” | Supabase değişken adlarını, URL'yi ve publishable anahtarını kontrol et; yeniden deploy et. |
| Google redirect mismatch | Google'daki redirect URI ile Supabase callback'ini; uygulama adresi ile Supabase URL ayarlarını eşleştir. |
| Google girişi oluyor ama erişim reddediliyor | Bir kez girişten sonra doğrulanmış e-postanla owner bootstrap çalıştır. Diğer kullanıcılar için davet gerekir. |
| “Set your verified, lowercase owner email” | SQL Editor kopyasında örnek adresi değiştir; küçük harf ve boşluksuz doğru e-posta kullan. |
| Eksik sağlayıcı / reddedilen model | [Tablodan](models.md) modelin servisini bul; bakiye ve model erişimini kontrol et. |
| İş kuyrukta kalıyor veya kaydedilemiyor | Kuyruk, Cron, sunucu secret/service-role ayarı ve Vercel fonksiyon hatalarını kontrol et. `media` özel kalsın, migration erişim kuralları korunsun. |
| Anahtarı kaydettin ama değişmedi | Webi yeniden deploy et. Mac'te Provider keys → Save kullanılır. |

Kod, log ve şema geliştirme için [geliştirici rehberine](development.md) devam et. Log/ekran görüntüsü paylaşmadan önce [SECURITY.md](../../SECURITY.md) dosyasını oku. Gereken ayarların doğruluk kaynağı uygulamanın sunucu kodu ve [başlangıç şemasıdır](../../supabase/migrations/20261019123903_banana_studio_baseline.sql).
