# Web çalışma alanını Docker ile çalıştır

[Ana sayfa](README.md) · [English](../en/docker.md) · [Anahtarlar](models.md) · [Vercel + Supabase kurulumu](deploy.md)

`compose.yaml`, **barındırılan sürümle aynı web çalışma alanını** kendi sunucunda çalıştırır: aynı arayüz, aynı `api/` fonksiyonları, aynı Supabase şeması ve satır düzeyi güvenlik. Google ile giriş, davet, Workspace admin, kullanım raporları, kalıcı görsel kuyruğu, devam ettirilebilir video yükleme ve herkese açık klasör bağlantıları çalışır. Vercel'de ya da Supabase'de hiçbir şey barındırılmaz.

| Konteyner | İmaj | Yerine geçtiği |
| --- | --- | --- |
| `app` | bu depodan derlenir | Vercel: arayüz, fonksiyonlar, Queues, Cron; Supabase API geçidi |
| `db` | `supabase/postgres` | Supabase Postgres |
| `auth` | `supabase/gotrue` | Supabase Auth (Google ile giriş) |
| `rest` | `postgrest/postgrest` | Supabase Data API |
| `storage` | `supabase/storage-api` | Supabase Storage (özel `media` kovası, dosyalar birimde) |

Yalnız `app` dışarı açılır; varsayılan adres `127.0.0.1:8080`. Siteyi sunar ve `/auth/v1`, `/rest/v1`, `/storage/v1` isteklerini iç servislere iletir. Böylece tarayıcı tek adres kullanır. Görsel ve video üretimini sağlayıcılar yapar; sunucunun CPU yükü düşük kalır. Boştaki yığın yaklaşık 350 MB RAM kullanır. İmajlar yaklaşık 4 GB disk ister; medya alanı galeriyle birlikte büyür.

## Başlamadan önce

- Docker ve Compose eklentisi kurulu bir Linux sunucu.
- Sunucunun önünde HTTPS'li bir alan adı (Caddy, Traefik, nginx, Cloudflare Tunnel). Uygulama `localhost` dışında `https://` ister.
- OAuth istemcisi için bir Google Cloud projesi (3. adım).
- Kullanacağın servis anahtarları; [anahtar rehberine](models.md) bak.

## 1. Yapılandırmayı oluştur

```sh
git clone https://github.com/orkunisitmak/banana-studio.git
cd banana-studio
node scripts/docker-env.mjs
```

Sunucuda Node yoksa aynı betiği bir konteynerde çalıştır:

```sh
docker run --rm -v "$PWD":/w -w /w node:24-slim node scripts/docker-env.mjs
```

Betik `.env.example` dosyasını `.env` olarak kopyalar ve iç gizli değerleri (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`) doldurur. Dolu bir değerin üzerine asla yazmaz. `.env` dosyasını gizli tut ve yedekle: veritabanı ve anahtarlar ona bağlıdır.

## 2. `.env` dosyasını doldur

| Değişken | Değer |
| --- | --- |
| `BANANA_PUBLIC_URL` | Kullanıcıların açtığı adres, örneğin `https://studio.example.com`. Yol ya da sondaki eğik çizgi yok. |
| `BANANA_OWNER_EMAIL` | Google hesabının adresi. İlk açılışta izin listesine girer; ilk girişten sonra yönetici olur. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 3. adımdan. |
| Servis anahtarları | `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `EVOLINK_API_KEY`, `YOUTUBE_API_KEY`; yalnız kullandıkların. |
| `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY`, `OPENAI_PROJECT_ID` | İsteğe bağlı yönetici fatura raporları. |
| `BANANA_BIND`, `BANANA_PUBLISH_PORT` | `app` için sunucu adresi ve portu (varsayılan `127.0.0.1` ve `8080`). |

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ve `CRON_SECRET` değerlerini boş bırak: bunlar Vercel kurulumuna aittir. Docker sunucusu bunları kendisi üretir.

## 3. Google OAuth istemcisini oluştur

1. [Google Cloud Console](https://console.cloud.google.com) içinde OAuth onay ekranını ayarla.
2. **Web application** türünde bir OAuth istemcisi oluştur.
3. **Authorized JavaScript origins:** `BANANA_PUBLIC_URL` değerin.
4. **Authorized redirect URIs:** `BANANA_PUBLIC_URL` + `/auth/v1/callback`, örneğin `https://studio.example.com/auth/v1/callback`.
5. İstemci kimliğini ve gizli anahtarı `.env` dosyasına kopyala. Onay ekranı test modundaysa hesabını test kullanıcısı olarak ekle.

## 4. Başlat

```sh
docker compose up -d --build
docker compose ps
```

İlk açılış uygulama imajını derler ve veritabanını oluşturur. `auth` ve `storage` şemalarını oluşturunca `app` konteyneri `supabase/migrations` dosyalarını kendisi uygular, sonra `healthy` olur. Ters vekil sunucunu `127.0.0.1:8080` adresine yönlendir. Vekil sunucu özgün `Host` başlığını iletmeli ve yükleme sınırın kadar istek gövdesine izin vermeli (nginx: `proxy_set_header Host $host;`, `client_max_body_size 512m;`).

**Kontrol:** `BANANA_PUBLIC_URL` adresini aç, `BANANA_OWNER_EMAIL` hesabıyla Google'dan giriş yap. Galeriyi ve **Workspace admin** düğmesini görürsün. Diğer kişileri Workspace admin'den davet et; davet edilmeyen Google hesabı reddedilir.

## Claude, ChatGPT ya da başka bir asistanı bağla (MCP)

Sunucu aynı zamanda **`BANANA_PUBLIC_URL/mcp`** adresinde uzak bir [MCP](https://modelcontextprotocol.io) sunucusudur. Onu özel bağlayıcı olarak ekle (Claude: **Settings → Connectors → Add custom connector**; ChatGPT: **Settings → Connectors**; Claude Code: `claude mcp add --transport http banana-studio https://studio.example.com/mcp`). Hiçbir yere anahtar kopyalanmaz:

1. Asistan kendini çalışma alanının giriş servisine kaydeder.
2. Tarayıcıda `/oauth/consent` açılır. Davet edilmiş Google hesabınla giriş yap ve **Allow** düğmesine bas.
3. Asistan artık senin adına çalışır. Davet denetimi, sağlayıcı seçimi ve kullanım raporları web uygulamasındaki gibi uygulanır.

| Araç | Görev |
| --- | --- |
| `list_models` | Görsel ve video modelleri; sunucuda her biri için anahtar olup olmadığı |
| `generate_image` | İsteğe bağlı HTTPS referans görseller ve klasörle bir görsel (GPT Image 2.5, Nano Banana Pro/2.1) kuyruğa alır |
| `generate_video` | Metinden ya da ilk/son kareden Seedance 2.0/2.5 videosu başlatır (fal.ai ya da OpenRouter anahtarı) |
| `get_generation` | Sonucu bekler ve bir saat geçerli indirme adresi verir; biten MCP videolarını galeriye kaydeder |
| `list_generations`, `list_folders` | Galeriye göz atar |

Sonuçlar galeride diğer üretimler gibi görünür. Bağlı asistanları **`/oauth/connections`** sayfasında gör ve bağlantılarını kes; bağlantı kesilince erişimleri hemen biter. Asistanlar yönetici onayı olmadan kaydolur, ama onları yalnız davet edilmiş hesaplar onaylayabilir. Kaydı kapatmak için `BANANA_MCP_DYNAMIC_REGISTRATION=false` yaz.

## Veri, yedek ve güncelleme

| Birim | İçerik |
| --- | --- |
| `banana-studio_db-data` | Postgres: hesaplar, galeri kayıtları, klasörler, People, şablonlar, işler, kullanım |
| `banana-studio_storage-data` | Yüklenen referanslar ve üretilen görseller/videolar |
| `banana-studio_db-config` | Postgres imajının oluşturduğu şifreleme anahtarı dosyaları |

- **Veritabanı yedeği:** `docker compose exec db pg_dump -U postgres -Fc postgres > banana-db.dump`
- **Medya yedeği:** `docker run --rm -v banana-studio_storage-data:/data -v "$PWD":/backup busybox tar czf /backup/banana-media.tgz -C /data .`
- **Güncelleme:** `git pull && docker compose up -d --build`. Yeni migration dosyaları açılışta uygulanır.
- **Durdurma / kaldırma:** `docker compose down` birimleri korur; `docker compose down -v` bütün veriyi kalıcı olarak siler.

## Ayarlar

| Değişken | Varsayılan | Görev |
| --- | --- | --- |
| `BANANA_MAX_UPLOAD_BYTES` | `524288000` (500 MB) | Storage'ın kabul ettiği en büyük tek medya dosyası. |
| `BANANA_IMAGE_WORKERS` | `4` | `app` içinde aynı anda işlenen görsel işi sayısı. |
| `BANANA_MCP_DYNAMIC_REGISTRATION` | `true` | MCP istemcilerinin kendini kaydetmesine izin verir. |

Bunları `.env` dosyasına yaz, sonra `docker compose up -d` çalıştır.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| `app` `starting` durumunda kalıyor, günlükte auth ve storage şemaları geçiyor | `docker compose logs auth storage` çıktısına bak; çoğunlukla veritabanı başka bir `POSTGRES_PASSWORD` ile oluşturulmuştur. |
| Google `redirect_uri_mismatch` gösteriyor | Yönlendirme adresi tam olarak `BANANA_PUBLIC_URL/auth/v1/callback` olmalı. |
| Giriş başarılı, sonra erişim reddediliyor | Bu hesap davet edilmemiş. Sahip, `BANANA_OWNER_EMAIL` içindeki adrestir. |
| “Use the HTTPS URL of your own Supabase project” | `BANANA_PUBLIC_URL`, `localhost` dışında düz `http://`. Önüne HTTPS koy. |
| `… is not configured. The workspace owner must add …` | O anahtarı `.env` dosyasına ekle ve `docker compose up -d` çalıştır. |
| Büyük yüklemeler başarısız | Vekil sunucunun gövde sınırını, gerekirse `BANANA_MAX_UPLOAD_BYTES` değerini yükselt. |
