# Banana Studio'yu Docker ile çalıştırın

[Ana sayfa](README.md) · [English](../en/docker.md) · [Anahtarlar](models.md) · [Web kurulumu](deploy.md)

Docker imajı, Mac ve Windows uygulamalarındaki bağımsız çalışma alanını çalıştırır: tek Node.js sunucusu, SQLite ve diskteki medya dosyaları. Bu alanı tarayıcıya sunar. Supabase, Vercel ya da Google girişi gerekmez. Görsel ve video üretimini yine sağlayıcılar yapar; sunucu isteği gönderir, işi izler ve sonucu saklar.

| | Docker sunucusu | Barındırılan web ([deploy.md](deploy.md)) |
| --- | --- | --- |
| Altyapı | Herhangi bir Linux sunucuda tek konteyner | Vercel + Supabase |
| Giriş | Ortak tek erişim anahtarı | Google hesapları, yönetici onayı |
| Veri | Docker biriminde SQLite + dosyalar | Supabase Postgres + Storage |
| Sağlayıcı anahtarları | Sunucu ortam değişkenleri | Sunucu ortam değişkenleri |
| Herkese açık klasör bağlantıları | Yok | Var |

Docker sunucusu **tek çalışma alanıdır**: erişim anahtarını bilen herkes aynı galeriyi görür ve düzenler. Herkesin ayrı hesabı gerekiyorsa barındırılan web kurulumunu kullanın.

## Başlatma

1. Docker'ı Compose eklentisiyle kurun.
2. Depoyu klonlayın ve yapılandırma dosyasını oluşturun:

   ```sh
   git clone https://github.com/orkunisitmak/banana-studio.git
   cd banana-studio
   cp .env.example .env
   ```

3. `.env` içinde `BANANA_ACCESS_TOKEN` değerine uzun, rastgele bir gizli değer yazın; örneğin `openssl rand -hex 24` çıktısı. En az 16 karakter olmalı.
4. Kullanacağınız sağlayıcı anahtarlarını ekleyin (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `EVOLINK_API_KEY`, `YOUTUBE_API_KEY`). Hangi anahtarın hangi özelliği açtığını [anahtar rehberi](models.md) anlatır. Supabase ve Vercel değişkenlerini boş bırakın.
5. Başlatın:

   ```sh
   docker compose up -d --build
   ```

6. <http://localhost:8080> adresini açın, erişim anahtarını girin ve **Open workspace** düğmesine basın.

**Kontrol:** üst çubukta **Self-hosted workspace**, boş bir galeri ve üretim denetimleri görünür. `docker compose ps` konteyneri `healthy` gösterir.

## Yapılandırma

| Değişken | Varsayılan | Görev |
| --- | --- | --- |
| `BANANA_ACCESS_TOKEN` | — (zorunlu) | Giriş anahtarı. Sunucu yalnız SHA-256 özetini tutar; değiştirince herkesin oturumu kapanır. |
| `BANANA_PUBLIC_URL` | `http://localhost:8080` | Tarayıcıya yazılan tam adres. Başka bir alan adıyla gelen istekler reddedilir. |
| `BANANA_PUBLISH_PORT` | `8080` | Compose'un sunucuda açtığı port. Değiştirirseniz `BANANA_PUBLIC_URL` değerini de değiştirin. |
| Sağlayıcı anahtarları | boş | Konteyner açılırken okunur. Düzenledikten sonra `docker compose up -d` çalıştırın. |

İmaj ayrıca `BANANA_PORT` (konteyner portu, `8080`) ve `BANANA_DATA_DIR` (`/data`) değerlerini okur.

## Alan adına bağlama

HTTPS'i sonlandıran bir ters vekil sunucunun (Caddy, Traefik, nginx, Cloudflare Tunnel) arkasında çalıştırın ve herkese açık adresi yazın:

```sh
BANANA_PUBLIC_URL=https://studio.example.com
```

Vekil sunucu özgün `Host` başlığını iletmeli (Caddy, Traefik ve Cloudflare Tunnel bunu varsayılan olarak yapar; nginx'te `proxy_set_header Host $host;`). 512 MB'a kadar yüklemeye izin vermeli (nginx'te `client_max_body_size 512m;`). `https://` adresinde oturum çerezi `Secure` olarak işaretlenir. Düz HTTP portunu internete açmayın; yalnız vekil sunucuya bağlayın, örneğin `127.0.0.1:8080:8080`.

Yanlış erişim anahtarı bir saniye bekledikten sonra yanıt alır, ama tek koruma bu anahtardır. Uzun ve rastgele bir değer kullanın. Adres herkese açıksa vekil sunucuya ek erişim denetimi koyun.

## Veri, yedek ve güncelleme

Her şey `banana-data` biriminde durur: `workspace.sqlite` (galeri, klasörler, şablonlar, People, işler) ve `media/` (yüklenen referanslar ve üretilen sonuçlar). Üretim yerel CPU ya da GPU kullanmaz; disk kullanımı galeriyle birlikte büyür.

- **Yedek:** SQLite tutarlı kalsın diye konteyneri durdurun, sonra birimi kopyalayın:

  ```sh
  docker compose stop
  docker run --rm -v banana-studio_banana-data:/data -v "$PWD":/backup busybox tar czf /backup/banana-data.tgz -C /data .
  docker compose start
  ```

- **Güncelleme:** `git pull && docker compose up -d --build`. Birim korunur.
- **Kaldırma:** `docker compose down` veriyi korur; `docker compose down -v` veriyi kalıcı olarak siler.

Birim adının önünde Compose proje adı (varsayılan olarak klasör adı) bulunur; `docker volume ls` adı gösterir.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Konteyner hemen kapanıyor | `docker compose logs` eksik ya da geçersiz değişkeni söyler; çoğunlukla `BANANA_ACCESS_TOKEN` boştur ya da kısadır. |
| `Invalid local host.` | Tarayıcı adresi `BANANA_PUBLIC_URL` ile eşleşmiyor ya da vekil sunucu `Host` başlığını değiştiriyor. |
| Girişte `Cross-origin requests are not allowed.` | `BANANA_PUBLIC_URL` adresini `https://` dahil aynen açın; vekil sunucu tarayıcının `Origin` başlığını değiştirmemeli. |
| `… is not configured. The workspace owner must add …` | O anahtarı `.env` dosyasına ekleyin ve `docker compose up -d` çalıştırın. |
| Vekil sunucu arkasında büyük yüklemeler başarısız | Vekil sunucunun istek gövdesi sınırını yükseltin. |
