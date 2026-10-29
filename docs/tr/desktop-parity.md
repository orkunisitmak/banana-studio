# Mac ve Windows masaüstü davranışları

[Kurulum](desktop.md) · [English](../en/desktop-parity.md)

İki uygulama aynı React derlemesini ve yerel Node/SQLite sunucusunu kullanır. Library, şablonlar, üretim, Enhance, Brainstorm, maske, ilerleme, karşılaştırma ve preview için ayrı Windows arayüzü yoktur.

| İşlem | Mac | Windows |
| --- | --- | --- |
| Generate | Command + Enter | Ctrl + Enter |
| Enhance | Command + Shift + E | Ctrl + Shift + E |
| Simple Brainstorm | Command + Shift + S | Ctrl + Shift + S |
| YouTube Brainstorm | Command + Shift + Y | Ctrl + Shift + Y |
| Galeri arama | Command + K | Ctrl + K |
| Kopyala / yapıştır / tümünü seç | Command + C / V / A | Ctrl + C / V / A |
| Metinde geri al | Command + Z | Ctrl + Z |
| Metinde yinele | Command + Shift + Z | Ctrl + Y / Ctrl + Shift + Z (yerel editör) |
| Metin alanı dışında silinen referansı geri al | Command + Z | Ctrl + Z |
| Görsel gezme / kapatma | Sol / Sağ / Escape | Sol / Sağ / Escape |
| Detay paneli | Shift + B | Shift + B |
| Yeni maske katmanı | Shift + çizim | Shift + çizim |
| Sağlayıcı anahtarları | Command + virgül | Ctrl + virgül veya File menüsü |
| Pencereyi tam ekran yapma | Control + Command + F | F11 (çıkmak için F11 veya Esc) |

Metin yapıştırma odaktaki editörde gerçekleşir; Türkçe karakterler, satırlar ve `@` referansları korunur. Görsel yapıştırma, panonun görsel öğelerini veya dosya listesini okur ve ortak referans yükleme akışını kullanır. Arka planda pano takip edilmez. Dosya yolunu metin olarak kopyalamak dosyayı yüklemez; kaynak uygulama görsel verisi sunmuyorsa yükleme düğmesini kullan.

Library; People grupları, referanslar ve şablonlarla birlikte yerelde saklanır. Rastgele portla açılan sunucu yeniden başlatıldığında görsel adresleri yenilenir. Video preview byte range destekler. Görseller kendi en boy oranıyla gösterilir; orijinal görsel, kaynak/edit karşılaştırması ve indirme ortak galeri kodunu kullanır.

Yerel farklar: Mac AppKit/WKWebView, Keychain ve imzalı Sparkle güncellemelerini kullanır. Windows WinForms/WebView2, Credential Manager ve GitHub'dan elle güncellemeyi kullanır. Windows zip'inde .NET, Node ve görsel codec'i bulunur; Microsoft WebView2 Runtime gerekir. Masaüstü galerileri birbirine veya web galerisine otomatik eşitlenmez.

## Doğrulama

Ortak testler pano görselinin iki koleksiyondan okunmasını, çift eklenmemesini, yerel komutları, Library kalıcılığını, yeniden başlatma sonrası görsel adreslerini, veri erişim sınırlarını, video range ve kalıcı işleri kontrol eder. Mac ve Windows CI paketlenmiş sunucuda sentetik üretim ve alan editi çalıştırır; seçimin dışındaki her pikseli kontrol eder. Sağlayıcı taklit edilir, ücretli istek yapılmaz. Windows'ta test için ayrı bir Credential Manager kaydı eklenip kaldırılır. Mac'in iki işlemci sürümü de CI'da derlenir.

Bu kontroller fiziksel Windows oturumundaki etkileşimli pano, dosya seçici, kısayol, oynatma ve ekran ölçeği testlerinin yerini tutmaz. Yayının doğrulama dosyası bu sınırı belirtir. Yeni topluluk sürümüne geçerken bu akışları hassas olmayan kendi örneklerinle kontrol et.

Görsel açıkken + / − yakınlaştırma, 0 ekrana sığdırma kısayollarıdır. İki masaüstü sürümü normal pencere konumunu ve boyutunu hatırlar; çıkarılmış monitörün koordinatları yerine görünür ekrana sığdırır. Tam ekran/büyütülmüş mod geri yüklenmez. macOS açılışı Windows gibi 30 saniyeyle sınırlandırılır; başarısız açılışta alt sunucu durdurulur, kayıtlı dosyalar korunur.
