# Banana Studio ile ilk projen

[Ana sayfa](README.md) · [English](../en/guide.md) · [Kurulum](desktop.md) · [Modeller ve anahtarlar](models.md)

Banana Studio yaratıcı bir projenin adımlarını aynı yerde toplar: referanslarını hazırla, fikrini anlat, alternatifleri keşfet, üret, düzenle ve sakla. Yapay zekâ modelleri harici servislerdir; uygulama bunları kullanacağın arayüz ve proje düzenleyicisidir.

## Çalışma alanını seç

Mac'te kişisel kullanım için [bağımsız uygulamayı indir](desktop.md). Yerel bir galeri açar, yalnızca kullanacağın servislerin anahtarlarını ister. Banana Studio hesabı açman veya veritabanı kurman gerekmez.

Windows kullanıcılarının da erişeceği ortak bir alan için [web sürümünü kur](deploy.md). Alan sahibi Google girişini, erişimi ve sunucu anahtarlarını yönetir. Masaüstü ve web galerileri ayrıdır; aralarında otomatik aktarım yoktur.

## İlk görselini üret

1. Mac'te **Provider keys** bölümünü aç; webde alan sahibinden servisi ayarlamasını iste.
2. İlgili anahtarı ekle. Örneğin GPT Image 2.5, OpenAI anahtarı kullanır.
3. Görsel üretimini ve anahtarını eklediğin modeli seç.
4. İstediğini yaz: “Gün doğumunda bir dağ evinin sıcak tonlarda editoryal illüstrasyonu; sade şekiller, geniş kompozisyon.”
5. Modelin desteklediği en-boy oranı, boyut, kalite ve görsel sayısını seç. Ücret tahmini yol gösterir; sabit fiyat değildir.
6. **Generate image** düğmesine bas. İşi galeriden takip et; sonucu aç veya indir.

Promptu kendin yazabilirsin. Enhance ve Brainstorm isteğe bağlıdır; farklı bir servis anahtarı gerektirebilir.

## Referansı kullan, istemeden edit yapma

**REF / Add reference images** düğmesinden, kütüphaneden veya bir galeri sonucundan görsel ekle. `@` menüsüyle amacını belirt: nesne, kişi, renk paleti veya stil örneği.

Örneğin: “Yeni bir split-screen sahne oluştur. Solda `@[Reference 1]`, sağda `@[Reference 2]` içindeki kişi olsun.” Editörün sunduğu gerçek etiketleri kullan.

Referans eklemek **yeni görsel üretimi** başlatır. Korumalı alan düzenleme ancak açıkça **Edit image** bölümüne girip alan seçtiğinde başlar. Stil örneği görsel dil için yol gösterir; otomatik olarak kopyalanacak sahneye veya kullanılacak kimliğe dönüşmemelidir.

**People** kayıtları aynı kişinin fotoğraflarını gruplar. Aynı kişiye ait birden fazla fotoğraf, birden fazla kişi istenmesi anlamına gelmez. İstediğin pozu, hareketi ve kıyafeti brief'e yaz.

## Enhance ve Brainstorm

![Gerçek kapakların üzerinde Brainstorm paneli](../assets/brainstorm-real.jpg)

**Brainstorm** içinde genel görsel fikirleri için **Simple**, kapaklar için **YouTube** seç. Fikir sayısı, araç çubuğundaki görsel sayısından ayrıdır. Örneğin beş fikir ve fikir başına dört görsel, yirmi sonuç üretir. Referans rolü özeti kimlik fotoğraflarını gruplar; aynı kişiye ait altı fotoğraf hâlâ tek kişiyi temsil eder.

Farklı konseptlerden oluşan bir seri yerine mevcut fikrini geliştirmek istediğinde **Enhance** kullan. Seçili üretim modeline uygun talimat hazırlar; göndermeden önce metni kontrol edip düzenleyebilirsin. **Revert**, hazırlama öncesindeki taslağı geri getirir.

**Enhance**, brief'i üretim talimatına dönüştürür. **Brainstorm**, farklı fikirler önerir; fikir başına birden fazla görsel üretilebilir. **AI settings** üzerinden OpenRouter bağlantılı Opus 5.5, OpenAI bağlantılı GPT-6.1 Sol veya Google bağlantılı Gemini 3.8 Flash seçebilir, düşünme seviyesini ayarlayabilirsin. Başlangıç ayarı Opus 5.5 / Medium'dur.

Üretim açıklamaları Türkçe yazsan da İngilizce hazırlanır. Görselde görünmesini istediğin yazılar, özel isimler ve alıntılanan diyaloglar istenen dilde korunur. Tam ifade önemliyse geliştirilmiş promptu gözden geçir.

YouTube kapaklarında Brainstorm, kişilerin kameraya bakması ve sen sabit kıyafet istemedikçe fikirler arasında farklı kombinler kullanılması yönünde talimat içerir. Bunlar modele verilen yönergelerdir; kusursuz anatomi, benzerlik veya tıklanma oranı garantisi değildir.

## Yalnızca seçtiğin bölümü düzenle

1. Galeriden bir görsel aç, **Edit image** seç.
2. **Mask** ile çevresini çiz veya **Rectangle** ile kutu seç. Kapalı maskenin içi dolar.
3. Birden fazla alan için katmanları kullan. **Shift + çizim** katman ekler; seçtiğin katmanı yeniden çizebilir veya yatay şeritten kaldırabilirsin.
4. Değişikliği anlat; modeli, kaliteyi ve görsel sayısını seç; istersen promptu Enhance et.
5. İstersen **REF** ile ek referans görselleri yükle; edit promptunda `@` yazarak etiketlerini kullan.
6. İşi gönder, yeni sonuçları incele. Kaynak/sonuç karşılaştırma kaydırıcısıyla değişikliği kontrol et.

Sonuç yalnızca son seçimin içine uygulanır; dış pikseller kaynak görselden korunur. Poz veya siluet değişecekse yeterli çevreyi seç: elde tutulan nesneyi silmek için el ve bilek de seçime dahil edilmek zorunda olabilir. Uygulama seçimini kendiliğinden genişletmez.

![Gerçek alan editörü, referanslar ve prompt kontrolleri](../assets/edit-controls-real.jpg)

İş kabul edilince Generate düğmesi yeni gönderim için açılır; kilitli bir “Generating” durumunda beklemen gerekmez. Sonuçlar editörün sonuç şeridine ve ayrı galeri kayıtlarına gelir. Başka deneme için mevcut kaynağı ve seçimleri tutabilir veya bitmiş sonucu inceleyebilirsin.

![Daha önce tamamlanmış editin kaynakla karşılaştırması](../assets/comparison-real.jpg)

Yeni sonuçtan devam etmek için **Edit this result**, ilk kaynaktan tekrar denemek için kaynağa dönüş seçeneğini kullan. Sonuçlar ayrı galeri kayıtlarıdır.

## YouTube kapağı planla

1. **YT** bölümünü aç, kanal veya video bul. Arama YouTube Data API anahtarı kullanır.
2. Videoyu analiz et. Görüntüyü Gemini okur; seçili yaratıcı model son brief'i hazırlar. [Birlikte gereken anahtarları incele](models.md).
3. Bölümün ana vaadini ve seçili kişileri kontrol et. Farklı yön için Brainstorm'dan önce brief'i değiştir.
4. Kimlik/nesne referansları veya kanalın önceki kapaklarını stil örneği olarak ekle. Amaç belirsizse referansın rolünü açıkla.
5. Fikir ve görsel sayılarını belirle, Brainstorm yap ve sonuçları karşılaştır.
6. Bir sonucu açıp **YouTube Preview** ile örnek YouTube akış yerleşiminde değerlendir.

Analiz, süresi bilinen, yayımlanmış ve en fazla 2,5 saatlik videoları kabul eder; aktif canlı yayınlar desteklenmez. Google'ın/sağlayıcının videoya erişebilmesi de gerekir. Analizi kullanmadan önce gözden geçir.

## Video üret

Önce modeli seç; modlar, süreler, boyutlar ve gerekli girdiler değişir.

| Aile | Akış |
| --- | --- |
| Seedance 2.0 / 2.5 Relaxed | Metin, görsel ve referanslarla üretim; desteklenen edit/uzatma kontrolleri. Seedance 2.5 first/last frame modunda ilk ve son kare olarak işaretlenmiş **iki durağan görsel** kullanılır. |
| MiniMax H3 Max | Text to Video Max, Image to Video Max, Reference to Video Max, Extend Video Max, Lip Sync Max ve Recast. |

Arayüz girdileri kontrol eder, moda uygun kontrolleri gösterir. Bazı video referanslarının hazırlanması ayrıca fal.ai gerektirir. İşler sürerken masaüstü uygulamasını açık tut. Webde OpenAI görsel işleri için kalıcı kuyruk vardır; diğer servislerin kendi iş kayıtları ve takip akışları kullanılır. Zaman aşımı, ücretli isteğin hiç kabul edilmediği anlamına gelmez. Yeniden göndermeden önce işi/sonucu kontrol et.

[![Gerçek video üretimi önizlemesi](../assets/video-preview.gif)](https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4)

Bu, dokümantasyon için küçültülmüş ve sesi çıkarılmış mevcut bir MiniMax H3 klibidir. [15 saniyelik MP4'ü indir](https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4). Uygulamadaki oynatıcıda zaman çizgisi, oynat/duraklat, ses ve tam ekran kontrolleri bulunur. Geçmiş bir üretimdir; yeni H3 Max testi değildir.

## Düzenle ve yeniden kullan

Klasörleri, favorileri ve aramayı kullan. Referans, kişi ve şablon kaydet. Detaylarda mevcut prompt, model, boyut, maliyet, referans ve maske bilgileri gösterilir; eski kayıtlarda bazı alanlar bulunmayabilir. Re-create ayarları geri getirir; varyasyonlar alternatifleri keşfetmeni sağlar.

Görselleri doğal oranında aç. Tekerlek/pinch ile yakınlaştır, sürükleyerek gez, çift tıklayıp sığdır. Details düğmesi veya **Shift+B** ile yan paneli gizle; metin alanı dışında sol/sağ oklarla görsel değiştir. Mobilde sola/sağa kaydırarak gezin, görseli aşağı kaydırarak detaydan çık. Edit hareketleri alan seçimine ayrılır.

Çoklu seçimle çalışmaları birlikte taşı veya indir; grid yoğunluğunu ve görsel/video filtresini değiştir. Karşılaştırma penceresi seçili görselleri karşılaştırır; editlenmiş görselin **Comparison** anahtarı ayrıca kaynak/sonuç sliderını açar. Galeri aramasını **⌘K / Ctrl+K** ile açabilirsin. Prompt ve ayarları şablon olarak, kimlik koleksiyonlarını People altında, diğer referansları ayrı kütüphanede sakla.

Herkese açık klasör bağlantıları ve çok kullanıcılı yönetim web sürümüne aittir. Yerel Mac klasörleri için herkese açık bağlantı oluşturulmaz.

## Aylık harcama limiti koy

Bu ayın tahmini harcamasını **AI settings** içinde görürsün (takvim ayı, UTC). Masaüstü uygulamasında aylık bütçeyi buradan belirlersin; boş bırakırsan limit olmaz. Web sürümünde yöneticiler üyeler için varsayılanı **Workspace admin → Settings → Monthly spending** bölümünden ayarlar; bir hesaba ayrı limit verebilir ya da onu limitten muaf tutabilir. Yöneticiler, kendi hesaplarına limit koymadıkça varsayılandan etkilenmez.

Limite ulaşıldığında yeni görsel, edit, video, Enhance ve Brainstorm istekleri *Spending Limit Reached* mesajıyla durur. Kabul edilmiş işler yine tamamlanır; bu yüzden son istek harcamayı limitin biraz üzerine çıkarabilir. Limit, Banana Studio'nun maliyet tahminlerine dayanır; sağlayıcın ayrıca faturalandırır.

Devam et: [Masaüstü](desktop.md) · [Anahtarlar](models.md) · [Web kurulumu](deploy.md) · [Geliştirme](development.md) · [Güvenlik](../../SECURITY.md)
