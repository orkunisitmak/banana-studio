# Banana Studio kurulumu ve kullanımı

[Ana sayfa](README.md) · [English](../en/desktop.md) · [Kullanım](guide.md) · [Anahtarlar](models.md)

## Mac: indir ve aç

Mevcut sürüm **v0.1.2**, gereken sistem **macOS 13.5 veya sonrası**. Çalışma ortamı pakete dahildir; Node.js, Supabase, Vercel veya veritabanı kurmazsın.

1. Apple menüsünden **Bu Mac Hakkında / About This Mac** bölümünü aç. **Çip: Apple M…** yazıyorsa Apple Silicon; **Intel** yazıyorsa Intel indir.
2. Uygun dosyayı seç:

   | Mac | İndirme |
   | --- | --- |
   | Apple Silicon — M1 ve yenileri | [Banana-Studio-0.1.2-macos-arm64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-arm64.zip) |
   | Intel | [Banana-Studio-0.1.2-macos-x64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-x64.zip) |

3. Zip'e çift tıkla, **Banana Studio.app** dosyasını **Applications / Uygulamalar** klasörüne taşı ve oradan aç.
4. Bu topluluk paketleri Apple tarafından notarize edilmemiştir. İlk açma denemesinden sonra macOS engellerse **Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç / Open Anyway** bölümünden yalnızca Banana Studio için izin ver ve sistemin onayını tamamla. [Apple'ın rehberini izle](https://support.apple.com/102445); sistem genelindeki korumaları açık tut.
5. Yerel galeri açılır. Google ile giriş veya Banana Studio hesabı gerekmez.

**Kontrol:** üstte **Local workspace · This computer**, boş galeri ve üretim kontrollerini görmelisin. Uygulamayı kullanmak için GitHub'ın **Source code** zip'ini değil, işlemcine uygun uygulama zip'ini indir.

## Gereken anahtarları ekle

1. Üstteki **Provider keys** düğmesini veya Mac menüsündeki **Banana Studio → Provider API Keys…** seçeneğini aç.
2. [Sağlayıcı bağlantılarından](models.md) kullanacağın serviste anahtar oluştur. Servisin ödeme veya model erişimi açmanı istemesi mümkündür.
3. Anahtarı ilgili kutuya yapıştır ve **Save** seç. Anahtarı üretim promptuna yazma.
4. O servise ait görsel/video modelini seç. Enhance veya Brainstorm için **AI settings** bölümünde anahtarını eklediğin bir metin modeli de seç.

Başlangıçta GPT Image 2.5 + Opus 5.5 / Medium seçilidir; OpenAI + OpenRouter gerekir. Yalnızca OpenAI kullanmak istiyorsan hesabının erişimi varsa metin modelini de GPT-6.1 Sol seç. Enhance/Brainstorm'u kullanmadan doğrudan görsel promptu da yazabilirsin.

**Kontrol:** yeniden açınca kayıtlı alan **Saved in Keychain** yazar. Boş bıraktığın alan mevcut anahtarı korur; **Remove** yalnızca o sağlayıcının kayıtlı anahtarını siler. Anahtarlar macOS Anahtar Zinciri'ndedir; Banana Studio bulut hesabına gönderilmez.

## Kaydet, yedekle ve güncelle

| Ne? | Nerede / nasıl? |
| --- | --- |
| Galeri, klasörler, referanslar, şablonlar ve iş kayıtları | `~/Library/Application Support/Banana Studio/` içindeki SQLite veritabanı ve medya dosyaları |
| API anahtarları | Galeriden ve uygulama paketinden ayrı olarak macOS Anahtar Zinciri'nde |
| Veri klasörünü bulmak | **File → Open Local Data Folder** |
| Sonucu dışarı almak | Galeriden indir |
| Alanı yedeklemek | Uygulamayı kapat, veri klasörünün tamamını yedekle. Veritabanının yanında medya dosyalarını da dahil et. |
| Uygulamayı güncellemek | Sparkle imzalı GitHub akışını kontrol eder. Elle kontrol için **Banana Studio → Check for Updates…**. |

Üretim sırasında uygulamayı açık tut; pencereyi küçültebilirsin. Kapatmadan veya güncellemeden önce işleri bitir. Uygulama, akışın ve güncelleme arşivinin imzasını açmadan önce doğrular. Çalışma alanın ve Anahtar Zinciri kayıtların paketin dışındadır; güncellemede korunur. Topluluk sürümü güncellendiğinde macOS yeniden Anahtar Zinciri erişimi isteyebilir; isteğin Banana Studio'ya ait olduğunu kontrol et.

Yerel veritabanı ayrıca şifrelenmez; dosyaları Mac hesap güvenliği, FileVault ve yedek ayarların korur. Uygulamayı yeniden kurmak galeri yedeği değildir. Yapay zekâ üretiminde seçtiğin prompt ve referanslar ilgili sağlayıcıya gönderilir. [Veri politikası](../../SECURITY.md).

## Windows: indir ve aç

1. 64-bit Intel/AMD işlemcili Windows 10/11 için [Banana-Studio-0.1.2-windows-x64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-windows-x64.zip) indir.
2. **Tümünü ayıkla** seç. Çıkan **Banana Studio** klasörünü bütün olarak tut; zip içinden çalıştırma, yalnızca `.exe` dosyasını taşıma.
3. **BananaStudio.exe** aç. Node.js, .NET ve yerel veritabanı dahildir. Microsoft **Edge WebView2 Runtime** gerekir; Windows 10/11'de genellikle bulunur. Eksik olduğu belirtilirse [Microsoft'tan](https://developer.microsoft.com/microsoft-edge/webview2/) kur.
4. **Provider keys** veya **File → Provider API Keys…** ile gereken anahtarları ekle. Anahtarlar **Windows Credential Manager** içinde saklanır. Supabase, Google girişi veya sunucu kurulumu gerekmez.
5. Mac ile aynı Library, galeri, preview, görsel/video üretimi ve edit kontrollerini kullan.

Bu **imzasız topluluk sürümüdür**. Windows, tanınmayan yayıncı uyarısı gösterebilir. Arşivin bu reponun yayınından geldiğini ve SHA-256 değerinin `verification-windows-x64.json` ile eşleştiğini kontrol et. Windows güvenliğini kapatma, başka kaynaktan paket kullanma.

Galeri `%LOCALAPPDATA%\Banana Studio\` içindedir; **File → Open Local Data Folder** ile aç. Yedeklemeden önce uygulamayı kapat ve tüm klasörü yedekle. Anahtarlar Credential Manager'da ayrı tutulur. Windows güncellemeleri elle yapılır: **File → Check for Updates…** GitHub Releases'i açar; uygulamayı kapat, yeni klasörü ayıkla ve çalıştır. Galeri ve anahtarlar uygulama klasörünün dışında kalır.

Mac, Windows ve Linux aynı React arayüzünü ve SQLite çalışma alanını kullanır. Yerel menüler, dosya seçiciler ve anahtar saklama yöntemi işletim sistemine uygundur. Windows paketine Windows CI üzerinde derleme, Credential Manager ve korumalı edit entegrasyon testleri uygulanır; tam yayın kabulü için etkileşimli Windows UI testi de gerekir. [Platform karşılaştırması ve kısayollar](desktop-parity.md).

## Linux: derle ve aç

Linux, Windows ile aynı React arayüzünü, Node/SQLite çalışma alanını ve görsel codec'ini **GTK 4 + WebKitGTK 6.0** penceresinde çalıştırır (Mac uygulamasıyla aynı WebKit motoru). glibc tabanlı 64-bit Intel/AMD veya ARM dağıtımlarda, GTK 4.10+ ile çalışır; Wayland ve X11 desteklenir. Henüz yayınlanmış bir Linux arşivi yok: [Linux uygulamasını derle](development.md#linux-uygulamasını-derle) adımlarıyla kaynak koddan derle veya bu reponun `prepared-linux-x64` CI çıktısını kullan.

1. Kabuk bileşenlerini bir kez kur. Node çalışma zamanı ve görsel codec'i pakete dahildir; `gst-libav` üretilen MP4 videoları oynatır.

| Dağıtım | Kabuk bileşenlerini kur |
| --- | --- |
| Arch / CachyOS / Manjaro | `sudo pacman -S --needed python-gobject gtk4 webkitgtk-6.0 libsecret gst-libav` |
| Debian 13 / Ubuntu 24.04+ | `sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-secret-1 gstreamer1.0-libav` |
| Fedora 40+ | `sudo dnf install python3-gobject gtk4 webkitgtk6.0 libsecret gstreamer1-plugin-libav` |

2. **banana-studio** klasörünü ayıkla veya derle ve dosyaları bir arada tut. Uygulama menüsüne eklemek için klasörün içinde `./install.sh` çalıştır ya da doğrudan `./banana-studio` ile aç. `./install.sh --uninstall` yalnızca menü kaydını kaldırır.
3. **Provider keys** (veya ☰ menü → **Provider API Keys…**, Ctrl + virgül) ile anahtarları ekle. Anahtarlar masaüstünün **Secret Service** anahtarlığında saklanır: GNOME Keyring, KWallet veya KeePassXC. Anahtarlık yanıt vermezse galeri yine açılır ama anahtar kaydedilemez.

Galeri `~/.local/share/banana-studio/` (veya `$XDG_DATA_HOME/banana-studio/`) içindedir; ☰ → **Open Local Data Folder** ile aç. Yedeklemeden önce uygulamayı kapat ve tüm klasörü yedekle. Anahtarlar anahtarlıkta ayrı tutulur. Güncellemeler elle yapılır: ☰ → **Check for Updates…** GitHub Releases'i açar; klasörü değiştir ve `./install.sh` komutunu yeniden çalıştır. İkinci kez açmak yeni bir çalışma alanı başlatmaz, mevcut pencereyi öne getirir. Wayland'de pencere konumunu bileşimci belirler; yalnızca boyut ve büyütülmüş durum hatırlanır.

Bazı NVIDIA sürücülerinde pencere boş kalırsa uygulamayı bir kez `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./banana-studio` ile başlat.

## Sık karşılaşılan durumlar

| Durum | Kontrol et |
| --- | --- |
| Mac uygulamayı açmıyor | Doğru işlemci paketini indir, Uygulamalar'a taşı, yukarıdaki uygulamaya özel Yine de Aç adımını izle. |
| Sağlayıcı ayarlanmamış hatası | O sağlayıcının anahtarını ekle; bu uygulamada Gemini anahtarı Nano Banana için `FAL_KEY` yerine geçmez. |
| Görsel üretildi ama Brainstorm çalışmıyor | Görsel ve metin modelleri farklı servis kullanabilir; **AI settings** bölümüne bak. |
| Anahtar kayıtlı ama istek reddediliyor | Sağlayıcı bakiyesini, ödeme ayarını, model erişimini, limitleri ve hata metnini kontrol et. |
| Webdeki galeri burada görünmüyor | Mac ve web alanları ayrı veri tutar. |
| Kaynak kod zip'ini indirdin | [Yayın sayfasındaki](https://github.com/orkunisitmak/banana-studio/releases/latest) işlemcine uygun uygulama zip'ini indir. |

Geliştiriciler: [geliştirme paketi oluşturma](development.md#mac-uygulamasını-derle). Yayın sorumluları: [imzalı yayın prosedürü](../RELEASING.md).
