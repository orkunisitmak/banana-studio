# Bağımsız Linux masaüstü

Linux masaüstü desteği ilk dağıtımda geliştirme önizlemesi olarak sunulur. Mevcut React arayüzünü ve `desktop/server` Node.js/SQLite çalışma alanını kullanır. Mac, Windows ve web başlatma yolları değişmez. Taşınabilir Linux x86_64 geliştirme paketi ve Ubuntu 24.04 için imzasız `.deb` üretimi desteklenir; otomatik güncelleme ve sürüm imzalama içermez.

Ubuntu 24.04 ve CachyOS için bağımlılık kurulumları, çalıştırma komutları ve kabul kontrolleri [İngilizce Linux alfa kılavuzunda](../en/linux-alpha.md) bulunur. Ayrı bir **Node.js 24.x**, npm, grafik masaüstü/D-Bus oturumu, `/usr/bin/zenity` ve kilidi açılmış GNOME Keyring veya KWallet gerekir. Electron bağımlılığı yalnızca `desktop/linux` altında sabitlenmiştir.

Depo kökünde her iki npm kurulumunu ve açık Electron indirme adımını tamamladıktan sonra:

```sh
npm test
npm run test:linux
npm run typecheck
npm run build
npm run build:desktop
npm run audit
git diff --check
npm run start:linux
```

Anahtarlar yerel Zenity parola formunda girilir; boş alan kayıtlı değeri korur, `REMOVE` siler. Anahtarlar renderer yapılandırmasına aktarılmaz. `safeStorage` yalnızca kullanılabilir, açıkça tanımlanmış keyring arka uçlarıyla çalışır; `basic_text`, bilinmeyen veya kullanılamayan arka uçlarda uygulama hata verir. Düz metin yedekleme yoktur.

Kalıcı veriler `$XDG_DATA_HOME/banana-studio`, şifreli anahtar dosyası `$XDG_CONFIG_HOME/banana-studio`, Chromium önbelleği `$XDG_CACHE_HOME/banana-studio` altında saklanır. Varsayılanlar sırasıyla `~/.local/share`, `~/.config`, `~/.cache` altındadır. Bu dizinleri Git'e veya hata raporlarına eklemeyin. Kilitleme uygulamayı kapatır; galeri diskte kalır.

Root olarak veya `--no-sandbox` ile çalıştırmayın. Ubuntu AppArmor kısıtlamaları paketlenmemiş Electron'un başlamasını engellerse yalnızca geliştirme ikilisine özel yerel politika gerekir; genel güvenlik korumalarını kapatmayın.

macOS üzerinde çalışan testler gerçek Linux GUI, sandbox, keyring veya Linux raster doğrulaması değildir. Linux'ta form kaydetme/silme/iptal, kalıcılık, resim içe/dışa aktarma ve korumalı düzenleme, süreç hatası/kapanışı ve kilitli/kullanılamayan keyring davranışı ayrıca denenmelidir. Üretim öncesinde paketli sürümün gerçek Linux sandbox/keyring ve masaüstü kabul testleri, lisans/kaynak erişimi ve dağıtım denetimleri tamamlanmalıdır.

## Bağımsız Linux paketleri

Tam build/test/kurulum komutları [İngilizce paketleme bölümünde](../en/linux-alpha.md#build-a-self-contained-development-alpha) bulunur. Build makinesinde Node 24/npm, Git, tar, unzip; `.deb` üretmek için Linux x86_64 ve dpkg-deb gerekir. Paketli kullanıcı Git, npm, kaynak checkout’u veya sistem Node’u kurmaz. Zenity, masaüstü kütüphaneleri ve açık keyring sistem gereksinimleridir.

```sh
npm ci --ignore-scripts
npm ci --prefix desktop/linux --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:desktop
npm run audit
git diff --check
npm run package:linux
node scripts/audit-linux-distribution.mjs .build/linux-x64/BananaStudio
npm run test:linux:bundle
npm run package:linux:deb
```

Çıktılar `.build/linux-x64/BananaStudio/` ve `.build/linux-artifacts/` altındadır. CachyOS’ta taşınabilir paketin `banana-studio` başlatıcısını kullanın. Ubuntu’da checksum’u doğruladıktan sonra `.deb` dosyasını `sudo apt install ./dosya.deb` ile kurup `/usr/bin/banana-studio` çalıştırın. Ubuntu `.deb` paketini CachyOS’a kurmayın.

Paketleme resmî Linux Electron/Node ikililerini ve tam sabitlenmiş sharp/libvips bağımlılıklarını indirir; çıkarma öncesinde SHA-256, npm paketlerinde ayrıca lockfile SRI kontrolü yapar. Node tam olarak 24.19.0’dır. Host glibc’sine karşı derleme yapılmaz. Artefakt denetimi ELF mimarisi/glibc sınırı, tüm dosyaların hash manifesti, sırlar, haricî bağlantılar, gereksiz geliştirme dosyaları, dosya izinleri ve lisansları kontrol eder.

`.deb`, Ubuntu’nun user namespace kısıtlaması için yalnızca sabit `/opt/banana-studio/banana-studio-bin` yoluna özel AppArmor profili içerir. Chromium sandbox kapatılmaz, global sysctl veya setuid ayarı yapılmaz. Mac çapraz paketleme ve Linux konteyner sunucu testleri gerçek GUI kabulü sayılmaz. İncelenen paketler CachyOS/KDE ve Ubuntu 26.04.1/GNOME üzerinde kullanıcı tarafından doğrulandı; ayrıntılar aşağıdadır. Ubuntu 24.04 GNOME masaüstü, farklı sürüme yükseltme ve kilitli/erişilemeyen gerçek keyring kabulü takip QA işleridir.

Veri ve anahtar yolları değişmez; kaynak uygulamasını tamamen kapatıp özel verilerinizi yedekleyerek paketli sürümü deneyin. Kamuya dağıtımdan önce libvips/native bağımlılıkların karşılık gelen kaynaklarının erişilebilirliği ayrıca gözden geçirilmelidir; lisanslar ve build tarifi pakete eklenmiştir. Bu komutlar yayınlama veya imzalama yapmaz.

## Son kabul sonuçlarının kapsamı

İncelenen taşınabilir paket CachyOS/KDE Plasma 6’da, `.deb` Ubuntu **26.04.1**/GNOME’da gerçek donanımda doğrulandı: normal açılış, yerel resim seçimi, klasör ve PNG referans kalıcılığı. İki masaüstünde boş olmayan sahte OpenAI anahtarı kaydedildi; uygulama yeniden başlatılınca `(saved)` göründü, izole profilin şifreli yapılandırması kaldırılınca gösterge kayboldu. Bu gösterge özgün anahtarın bayt bazında aynen geri alındığını bağımsız olarak kanıtlamaz.

Ubuntu’da gerçek `apt --reinstall` ve `apt remove` / `apt install` sonrasında klasör ve kaydedilmiş referanslar korundu. Ubuntu **24.04** yalnızca temiz konteyner build/runtime testleriyle doğrulandı; GNOME masaüstü kabulü yapılmadı. AppArmor etkin tam sanal makine veya fiziksel kurulum bu takip kontrolü için uygundur.

AppArmor’daki `unconfined` profili kasıtlı bir Ubuntu user-namespace izni şimidir; uygulama dosya/ağ erişimini kısıtlayan enforce profili değildir. Yalnızca root’a ait sabit `/opt/banana-studio/banana-studio-bin` ikilisine bağlanır. Chromium sandbox ayarları ayrıca korunur. `Seccomp: 2` ve `NoNewPrivs: 1` gözlemleri bütün sandbox katmanlarının doğrulandığı anlamına gelmez.

[İngilizce kılavuzdaki](../en/linux-alpha.md#acceptance-status-and-remaining-distribution-work) Docker içindeki yalıtılmış dpkg lifecycle testi ve iki ayrı Electron sürecinde sentetik anahtar/digest testi gerçek anahtar veya ücretli istek kullanmaz. Ubuntu 24.04 GNOME, sentetik anahtarın tam değer karşılaştırması, kilitli keyring, farklı sürüme upgrade, purge/reinstall ve çalışan uygulama sırasında upgrade ayrı QA adımlarıdır. Uygulama uygulama XDG yaprak dizinlerinde ve anahtar dosyasında sembolik bağlantıları reddeder; mevcut veriyi başka yere taşımaz veya silmez.
