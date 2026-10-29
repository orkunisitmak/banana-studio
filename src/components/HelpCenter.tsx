import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleQuestionMark,
  Film,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  ListChecks,
  Play,
  Rocket,
  Sparkles,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';

interface HelpCenterProps {
  open: boolean;
  onClose: () => void;
}

type HelpSectionId = 'start' | 'references' | 'images' | 'videos' | 'models' | 'prompts' | 'troubleshooting';

const NAV_ITEMS: Array<{
  id: HelpSectionId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'start', label: 'Hızlı başlangıç', shortLabel: 'Başlangıç', icon: Rocket },
  { id: 'references', label: 'Referanslar nasıl çalışır?', shortLabel: 'Referanslar', icon: Link2 },
  { id: 'images', label: 'Görsel üretimi ve edit', shortLabel: 'Görsel', icon: ImageIcon },
  { id: 'videos', label: 'Video üretimi ve edit', shortLabel: 'Video', icon: Video },
  { id: 'models', label: 'Doğru modeli seç', shortLabel: 'Modeller', icon: ListChecks },
  { id: 'prompts', label: 'Prompt ve Enhance', shortLabel: 'Prompt', icon: WandSparkles },
  { id: 'troubleshooting', label: 'Sorun çözme', shortLabel: 'Sorunlar', icon: AlertTriangle },
];

const CodeTag: React.FC<{ children: React.ReactNode; tone?: 'violet' | 'amber' | 'cyan' | 'green' }> = ({ children, tone = 'violet' }) => {
  const tones = {
    violet: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
    amber: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
    cyan: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-200',
    green: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
  };
  return <code className={`inline-flex rounded-md border px-1.5 py-0.5 font-mono text-[0.9em] font-semibold ${tones[tone]}`}>{children}</code>;
};

const SectionHeading: React.FC<{ eyebrow: string; title: string; description: string }> = ({ eyebrow, title, description }) => (
  <div className="mb-6 max-w-3xl">
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-violet-400">{eyebrow}</p>
    <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
    <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-[15px]">{description}</p>
  </div>
);

const Note: React.FC<{ title: string; children: React.ReactNode; tone?: 'violet' | 'amber' | 'green' }> = ({ title, children, tone = 'violet' }) => {
  const tones = {
    violet: 'border-violet-500/25 bg-violet-500/[0.08]',
    amber: 'border-amber-500/25 bg-amber-500/[0.08]',
    green: 'border-emerald-500/25 bg-emerald-500/[0.08]',
  };
  const iconTones = {
    violet: 'bg-violet-500/15 text-violet-300',
    amber: 'bg-amber-500/15 text-amber-300',
    green: 'bg-emerald-500/15 text-emerald-300',
  };
  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${iconTones[tone]}`}>
          {tone === 'amber' ? <AlertTriangle className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <div className="mt-1.5 text-sm leading-6 text-gray-300">{children}</div>
        </div>
      </div>
    </div>
  );
};

const PromptExample: React.FC<{ label: string; children: React.ReactNode; result?: string }> = ({ label, children, result }) => (
  <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111720]">
    <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
      <Sparkles className="h-3.5 w-3.5 text-violet-400" />
      <span className="text-xs font-semibold text-gray-300">{label}</span>
    </div>
    <div className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-6 text-gray-300 sm:text-[13px]">{children}</div>
    {result && (
      <div className="border-t border-white/[0.07] bg-black/10 px-4 py-3 text-xs leading-5 text-gray-500">
        <span className="font-semibold text-gray-400">Neden iyi?</span> {result}
      </div>
    )}
  </div>
);

const Checklist: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="space-y-2.5">
    {items.map((item, index) => (
      <li key={index} className="flex items-start gap-2.5 text-sm leading-6 text-gray-300">
        <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

const ModelCard: React.FC<{ name: string; badge: string; badgeTone: string; bestFor: string; children: React.ReactNode }> = ({ name, badge, badgeTone, bestFor, children }) => (
  <div className="rounded-2xl border border-white/[0.08] bg-[#111720] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-bold text-white">{name}</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">{bestFor}</p>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${badgeTone}`}>{badge}</span>
    </div>
    <div className="mt-4 border-t border-white/[0.07] pt-4 text-sm leading-6 text-gray-300">{children}</div>
  </div>
);

export const HelpCenter: React.FC<HelpCenterProps> = ({ open, onClose }) => {
  const [activeSection, setActiveSection] = useState<HelpSectionId>('start');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Callers pass inline handlers; a parent re-render must not re-run the focus effect.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const goToSection = (sectionId: HelpSectionId) => {
    setActiveSection(sectionId);
    document.getElementById(`help-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="fixed inset-0 z-[400] bg-[#080b10]/90 p-0 backdrop-blur-md sm:p-3 lg:p-5" role="dialog" aria-modal="true" aria-labelledby="help-center-title">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden border-white/10 bg-[#0d1117] shadow-2xl sm:rounded-3xl sm:border">
        <header className="flex min-h-[72px] shrink-0 items-center justify-between gap-4 border-b border-white/[0.08] bg-[#111720]/95 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><CircleQuestionMark className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h1 id="help-center-title" className="truncate text-base font-bold text-white sm:text-lg">Help Center</h1>
              <p className="hidden text-xs text-gray-500 sm:block">Kısa fikrini Brainstorm ve Enhance ile üretime hazırla</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-1.5 text-[11px] font-medium text-emerald-300 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />7 konu · Görsel + Video
            </div>
            <button ref={closeButtonRef} onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-gray-400 transition-colors hover:border-white/15 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-violet-500" aria-label="Yardım merkezini kapat" title="Kapat (Esc)">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="shrink-0 border-b border-white/[0.08] bg-[#0b1016] lg:w-72 lg:border-b-0 lg:border-r">
            <div className="custom-scrollbar flex gap-2 overflow-x-auto p-3 lg:block lg:h-full lg:space-y-1 lg:overflow-y-auto lg:p-4">
              <div className="mb-3 hidden px-3 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600 lg:block">Konular</div>
              {NAV_ITEMS.map(({ id, label, shortLabel, icon: Icon }) => (
                <button key={id} onClick={() => goToSection(id)} aria-current={activeSection === id ? 'page' : undefined} className={`flex h-10 shrink-0 items-center gap-2.5 rounded-xl border px-3 text-xs font-semibold transition-colors lg:w-full ${activeSection === id ? 'border-violet-500/30 bg-violet-500/15 text-violet-200' : 'border-white/[0.07] bg-white/[0.02] text-gray-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white lg:border-transparent lg:bg-transparent'}`}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="lg:hidden">{shortLabel}</span>
                  <span className="hidden text-left lg:block">{label}</span>
                </button>
              ))}
              <div className="mt-6 hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 lg:block">
                <BookOpen className="h-5 w-5 text-violet-400" />
                <p className="mt-3 text-xs font-semibold text-gray-300">Altın kural</p>
                <p className="mt-1.5 text-xs leading-5 text-gray-500">İsteğini basitçe yaz, referanslarını @ etiketiyle belirt ve Generate’dan önce mutlaka Enhance kullan.</p>
              </div>
            </div>
          </aside>

          <main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto scroll-smooth">
            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-12">
              <section id="help-start" className="scroll-mt-6 border-b border-white/[0.08] pb-14">
                <SectionHeading eyebrow="01 · Hızlı başlangıç" title="Kısa yaz, doğru aracı kullan, sonra üret" description="Uzun ve teknik prompt yazmana gerek yok. İsteğini basitçe anlat; yeni görsel fikirlerinde Brainstorm, üretim ve edit isteklerinde ise Enhance sana yardımcı olsun." />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['1', 'Modu ve modeli seç', 'Görsel mi video mu? Düzenleme yapacaksan doğru Edit aksiyonunu seç.'],
                    ['2', 'Dosyaları ekle', 'Kullanılacak görsel, video ve sesi sürükleyip referans alanına bırak.'],
                    ['3', 'İsteğini basitçe yaz', 'İstediğin sonucu veya değişikliği söyle; kullandığın referansları @ etiketiyle belirt.'],
                    ['4', 'Enhance → Generate', 'Enhance ile promptu modele uygun hale getir, sonucu kontrol et ve ardından Generate’a bas.'],
                  ].map(([number, title, description]) => (
                    <div key={number} className="rounded-2xl border border-white/[0.08] bg-[#111720] p-4">
                      <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/15 text-xs font-bold text-violet-300">{number}</div>
                      <h3 className="mt-4 text-sm font-semibold text-white">{title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-gray-500">{description}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5"><Note title="Dosya ve etiket iki ayrı şeydir" tone="amber">Prompta yalnızca <CodeTag>@VIDEO_1</CodeTag> yazmak videoyu yüklemez. Önce video dosyasını referans alanına eklemelisin. Etiket, eklenen dosyanın hangi görevde kullanılacağını anlatır. Kısa isteğini yazdıktan sonra mutlaka <strong className="text-white">Enhance</strong> kullan.</Note></div>
                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><ImageIcon className="h-4 w-4 text-amber-300" /> Görsel için en kısa yol</h3>
                    <div className="mt-4"><Checklist items={[<>Yeni görsel için basit fikrini; video kapağı için videonun konusunu yaz.</>, <><strong className="text-white">Brainstorm</strong> içinde kategori ve fikir sayısını seç.</>, <>Maliyet önizlemesini kontrol edip Generate’e bas; görseller galeride hazırlanır.</>, <>Fotoğraf editinde kaynağı ekle, değişikliği basitçe yaz ve <strong className="text-white">Enhance</strong> kullan.</>]} /></div>
                  </div>
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Video className="h-4 w-4 text-cyan-300" /> Video için en kısa yol</h3>
                    <div className="mt-4"><Checklist items={[<>Sıfırdan video için fikrini basitçe yaz; referans kullanıyorsan dosyayı ekle.</>, <>Mevcut videoyu değiştirmek için videoyu ekle ve doğru Edit/Ref Edit aksiyonunu seç.</>, <>Kaynak videoyu kullandığın yerde prompta <CodeTag>@VIDEO_1</CodeTag> ekle.</>, <>İstediğin sonucu veya değişikliği yaz, <strong className="text-white">Enhance</strong> kullan ve sonra Generate’a bas.</>]} /></div>
                  </div>
                </div>
                <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#111720] p-5">
                  <h3 className="text-sm font-semibold text-white">Gallery’de sonuçtan sonra</h3>
                  <p className="mt-2 text-xs leading-5 text-gray-400">Görsel açıkken <CodeTag>+</CodeTag> / <CodeTag>−</CodeTag> ile yakınlaştırıp uzaklaştır, <CodeTag>0</CodeTag> ile tamamını ekrana sığdır. Sol/sağ oklar diğer görsellere geçer; <CodeTag>Shift+B</CodeTag> detay panelini gizler. Yakınlaştırma, görselin dosyasını değiştirmez.</p>
                  <p className="mt-2 text-xs leading-5 text-gray-500">Mobilde açık görselde sağa/sola kaydırarak gezinebilirsin. Toplu Fotoğraflar kaydı için görselleri seç, Prepare photos ve ardından Save to Photos’a dokun; iPhone paylaşım ekranında Görselleri Kaydet’i seç. Tek seferde en fazla 20 görsel hazırlanır.</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div><span className="text-xs font-semibold text-violet-300">Reference</span><p className="mt-1 text-xs leading-5 text-gray-500">Seçili çıktıyı yeni üretimde referans olarak kullanır.</p></div>
                    <div><span className="text-xs font-semibold text-lime-300">Re-create</span><p className="mt-1 text-xs leading-5 text-gray-500">Kaydedilmiş model, ayar ve referanslarla üretim formunu yeniden hazırlar.</p></div>
                    <div><span className="text-xs font-semibold text-cyan-300">Variation</span><p className="mt-1 text-xs leading-5 text-gray-500">Aynı fikrin farklı bir yorumunu hazırlamak için varyasyon akışını açar.</p></div>
                  </div>
                </div>
              </section>

              <section id="help-references" className="scroll-mt-6 border-b border-white/[0.08] py-14">
                <SectionHeading eyebrow="02 · Referanslar" title="Etiketler modele neyi nerede kullanacağını söyler" description="Seedance ve görsel üretiminde dosyayı ekledikten sonra thumbnail’a tıklayarak rol verebilir, prompt alanında @ ile referans seçebilirsin. H3 Max’te önce aksiyonu seç: Image to Video kareleri, Reference to Video ise kişi, stil, hareket ve ses referanslarını kullanır." />
                <div className="overflow-hidden rounded-2xl border border-white/[0.08]">
                  {[
                    ['@MAIN_PERSON', 'Me / 1st Person', 'Ana kişinin yüzü, saç stili, kıyafeti ve kimliği. Aynı kişi için birden fazla fotoğrafa Me rolü verilebilir.', 'amber'],
                    ['@SECOND_PERSON', 'Person 2', 'Sahnede ayrı kimliği korunacak ikinci kişi. Eski 2ND etiketleri korunur.', 'cyan'],
                    ['@PERSON_3', 'Person 3, 4…', 'Kişileri Saved References → People içinden oluştur ve düzenle; kişi kartına tıklayarak tüm fotoğraflarını taslağa ekle. Referans çubuğundaki Remove, kişinin taslaktaki tüm fotoğraflarını kaldırır; kişi olmayan referansta yalnız seçilen görseli kaldırır. Kayıtlı kişi kitaplığı değişmez. Kaldırmayı metin alanı dışında Ctrl/Cmd + Z ile geri alabilirsin.', 'violet'],
                    ['@REF_IMAGE_1', 'Genel görsel referansı', 'Ürün, obje, mekân, kompozisyon, renk veya görsel stil. Numara, eklenme sırasına göre oluşur.', 'violet'],
                    ['@VIDEO_1', 'Video referansı', 'Kaynak video, hareket, kamera, zamanlama veya sahne devamlılığı. Birden fazla videoda numara önemlidir.', 'violet'],
                    ['@AUDIO_1', 'Ses referansı', 'Destekleyen referans akışlarında ses, ritim, ambiyans, efekt veya müzik referansı. H3 Max’te Text/Image to Video hedef ses, Reference to Video ve Extend ses referansı, Lip Sync ise konuşma sesi kabul eder.', 'green'],
                  ].map(([tag, role, description, tone], index) => (
                    <div key={tag} className={`grid gap-3 bg-[#111720] p-4 sm:grid-cols-[170px_150px_1fr] sm:items-start sm:p-5 ${index > 0 ? 'border-t border-white/[0.07]' : ''}`}>
                      <div><CodeTag tone={tone as 'violet' | 'amber' | 'cyan' | 'green'}>{tag}</CodeTag></div>
                      <div className="text-xs font-semibold text-white sm:text-sm">{role}</div>
                      <p className="text-xs leading-5 text-gray-500 sm:text-sm sm:leading-6">{description}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <Note title="Seedance’te tek referans varsa" tone="green">Dosyayı ekle, doğru @ etiketiyle an ve istediğin sonucu basitçe yaz. Örneğin: “<CodeTag>@VIDEO_1</CodeTag> içindeki kişinin arkasından gerçekçi bir köpekbalığı gelsin.” Ardından mutlaka <strong className="text-white">Enhance</strong> kullan.</Note>
                  <Note title="Seedance’te birden fazla referans varsa">Her dosyanın işini ayrı söyle: “<CodeTag>@REF_IMAGE_1</CodeTag> ürün, <CodeTag>@REF_IMAGE_2</CodeTag> arka plan, <CodeTag>@VIDEO_1</CodeTag> kamera hareketi.” Kısa rol dağılımını yazdıktan sonra <strong className="text-white">Enhance</strong> ile promptu hazırla.</Note>
                </div>
                <div className="mt-4"><Note title="H3 Max’te referans ve kare rolleri" tone="amber">Image to Video’da görseller başlangıç/bitiş karesidir; görsel menüsünden rollerini değiştirebilirsin. Reference to Video’da Image 1, Video 1 ve Audio 1 numaraları kullanılır; @ menüsündeki referanslar gönderilirken bu adlara çevrilir. İstersen ayrı başlangıç, orta ve bitiş kareleri atayabilirsin.</Note></div>
                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  {[
                    ['Kişi kimliği', 'Aynı kişiye ait 2–4 net açı yükle. Hepsine Me rolü ver. Başka kişileri 2nd Person olarak ayır.'],
                    ['Stil / ürün / mekân', 'Rol vermeden eklenen görseller genel referans olur. Promptta her birine numarasıyla görev ver.'],
                    ['Video devamlılığı', 'Kaynak videoyu ekle; aynı klibi değiştirmek için Edit/Ref Edit, bağımsız klip için Generate, önceki çekimin sonundan yeni bir çekim için Continue kullan.'],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-xs leading-5 text-gray-500">{text}</p></div>
                  ))}
                </div>
              </section>

              <section id="help-images" className="scroll-mt-6 border-b border-white/[0.08] py-14">
                <SectionHeading eyebrow="03 · Görsel" title="Yeni fikirde Brainstorm, düzenlemede Enhance kullan" description="Sıfırdan görsel veya video kapağı üretirken kısa fikrini yaz, Brainstorm içinde fikir sayısını seç ve Generate’e bas. Fotoğraf düzenlerken kaynak görseli ekle, istediğin değişikliği basitçe yaz ve Enhance kullan." />
                <div className="mb-6 grid gap-4 lg:grid-cols-2">
                  <Note title="Yeni görsel veya video kapağı" tone="green">Kısa fikrini ya da videonun konusunu yaz → <strong className="text-white">Brainstorm</strong> içinde kategori ve fikir sayısını seç → maliyet önizlemesini kontrol et → Generate. Görseller galeride hazırlanır; promptları seçmen gerekmez.</Note>
                  <Note title="Fotoğraf düzenleme">Kaynak görseli ekle → gerekiyorsa <CodeTag>@REF_IMAGE_1</CodeTag> ile belirt → değişikliği basit dille yaz → <strong className="text-white">Enhance</strong> → Generate.</Note>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    ['Text-to-image', 'Basit fikrini yaz. Video kapağı yapıyorsan videonun konusunu belirt ve Brainstorm ile görsel fikirleri üret.', 'Yeni kahve markası için sıcak ve premium bir reklam görseli'],
                    ['Image edit', 'Kaynak görseli ekle. İstediğin değişikliği basitçe yaz; ardından mutlaka Enhance kullan.', '@REF_IMAGE_1 içindeki duvarı sıcak beton yap, ürün aynı kalsın.'],
                    ['Karakter tutarlılığı', 'Aynı kişinin tüm fotoğraflarına Me rolü ver. Bunlar tek kişinin farklı kimlik referanslarıdır; ayrı karakterler değildir. @MAIN_PERSON ile sahneyi yaz ve Enhance kullan.', '@MAIN_PERSON yağmurlu bir gece pazarında yürüsün.'],
                    ['Çok kişili sahne', 'Saved References → People içinde her kişiyi fotoğraflarıyla kaydet ve kişi kartından taslağa ekle. @ menüsünden kişi grubunu seç. Kimlik sayısı fotoğraf sayısından farklıdır. Yerleşimi ve toplam kişi sayısını açık yaz.', '@MAIN_PERSON ortada, @SECOND_PERSON solda, @PERSON_3 sağda. Toplam üç kişi, her biri bir kez.'],
                    ['YouTube linkinden kapak', 'Saved References → People içinden kişileri ekle. YT alanına yayınlanmış videonun linkini koy, kapakta görünecek kişileri seç ve Prepare Brainstorm’a bas. Video içeriği ve mevcut kapaktan düzenlenebilir brief hazırlanır; açılan Brainstorm panelinde fikir sayısını seçip Generate’e bas. Manuel brief gerekmez. Video okunamazsa sınırlı briefi önce incelemen istenir.', 'Kişileri ekle → YT linki → Prepare Brainstorm → fikir sayısı → Generate'],
                    ['Stil / ürün referansı', 'Genel referansları ekle, hangi dosyadan ne alınacağını kısaca belirt ve Enhance kullan.', '@REF_IMAGE_1 içindeki sandalyeyi, @REF_IMAGE_2 içindeki ışık stilini kullan.'],
                  ].map(([title, description, example]) => (
                    <div key={title} className="rounded-2xl border border-white/[0.08] bg-[#111720] p-5"><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-xs leading-5 text-gray-500">{description}</p><div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-5 text-gray-400">{example}</div></div>
                  ))}
                </div>
                <div className="mt-6"><Note title="Edit promptunun pratik formülü"><strong className="text-white">Referans + değişiklik + korunacaklar.</strong> Örneğin: “<CodeTag>@REF_IMAGE_1</CodeTag> içindeki paketi mat siyah yap, logo ve arka plan aynı kalsın.” Bu kısa isteğin ardından <strong className="text-white">Enhance</strong> kullan; uzun ve teknik promptu kendin yazmaya çalışma.</Note></div>
                <div className="mt-4"><Note title="Sunburst’te Brainstorm ve Enhance">Brainstorm seçtiğin boyut ve referans rollerine uygun fikirler hazırlar. Enhance genel isteklerde mevcut stili ve edit kapsamını korur. YouTube işlerinde kapak kompozisyonu, yüz tutarlılığı ve küçük ekranda okunaklılık yönergelerini kullanır. Görselde yazacak metni tırnak içinde, korunacak ayrıntıları açıkça yaz. Örneğin: “Yalnızca tabelayı ‘AÇIK’ olarak değiştir; yüz, kıyafet ve arka plan aynı kalsın.” Modeli veya kişi/referans eşleşmesini değiştirirsen Revert → tekrar Enhance yap. Aynı görsel modelinde boyut ve kalite değişikliği için Revert gerekmez. Boyut, kalite ve PNG formatı API ayarı olarak uygulanır; prompta eklenmez. Basit istekler kısa kalır; lokal editte kamera açısı, renkler, kontrast ve çevredeki ayrıntılar korunur.</Note></div>
              </section>

              <section id="help-videos" className="scroll-mt-6 border-b border-white/[0.08] py-14">
                <SectionHeading eyebrow="04 · Video" title="Video aksiyonu, referansın nasıl yorumlanacağını değiştirir" description="Aynı kaynak videoyu Generate ile vermek ve Edit ile vermek aynı işlem değildir. Önce hedefini aşağıdaki use case’lerden biriyle eşleştir." />
                <div className="space-y-4">
                  {[
                    ['01', 'Text-to-video · Sıfırdan klip', 'Video → model → Generate. Referans ekleme.', 'Fikrini ve görmek istediğin ana aksiyonu basitçe yaz; ardından Enhance kullan.', 'H3’te oran sabit seçilir; Adaptive yalnız referanslı üretimde görünür.'],
                    ['02', 'Image-to-video · Bir kareyi canlandır', 'H3 Max → Image to Video Max seç. Başlangıç ve isteğe bağlı bitiş görseli ekle; yalnız bitiş karesi de kullanılabilir. Görsel menüsünden kare rolü seç.', 'İstediğin hareketi basitçe ve doğal dille yaz, Enhance kullan ve sonra Generate’a bas.', 'H3 Max’te @ etiketi kullanılmaz ve oran kaynak kareyi takip eder.'],
                    ['03', 'Seedance reference-to-video · Kişi, stil, hareket veya ses kullan', 'Görsel/video/ses dosyalarını ekle ve her birine promptta @ etiketiyle görev ver.', '“@MAIN_PERSON kişi, @VIDEO_1 kamera hareketi, @AUDIO_1 ritim” gibi kısa bir rol dağılımı yaz ve Enhance kullan.', 'H3 Max → Reference to Video Max de çoklu referans kabul eder. En fazla 9 görsel, 3 video, 3 ses ve toplam 12 referans kullanılır.'],
                    ['04', 'Video edit · Kaynak klipte kontrollü değişiklik', 'Kaynak videoyu ekle. Seedance 2.5’te Edit; Seedance 2.0’da Ref Edit seç.', '“@VIDEO_1 içindeki kişinin arkasından gerçekçi bir köpekbalığı gelsin.” gibi basitçe yaz ve Enhance kullan.', '2.5 Edit kaynak oranını ve süresini kullanır. 2.0 Ref Edit farklı oran/süreyle kaynak odaklı yeniden yorumlama yapabilir.'],
                    ['05', 'Extend / Continue · Önceki çekimi sürdür', 'Aynı videoyu uzatmak için Seedance 2.5 → Extend. Yeni ama devam eden bir çekim için aksiyon menüsünden Continue seç; kaynak videoyu değiştirmek için ilgili videonun Continue rolünü kullan.', 'Sonraki aksiyonu basitçe yaz, kaynak videoyu @ etiketiyle belirt ve Enhance kullan.', 'Extend aynı klibi ileri uzatır; Continue ise önceki çekimden görsel bağ kuran yeni bir jenerasyondur. Tek bir video devamlılık kaynağı olur; diğerleri yardımcı referanstır.'],
                  ].map(([number, title, setup, prompt, note]) => (
                    <div key={number} className="grid gap-4 rounded-2xl border border-white/[0.08] bg-[#111720] p-5 lg:grid-cols-[48px_1fr_1fr] lg:gap-6">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-500/10 text-xs font-bold text-cyan-300">{number}</div>
                      <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-xs leading-5 text-gray-400"><span className="font-semibold text-gray-300">Kurulum:</span> {setup}</p><p className="mt-2 text-xs leading-5 text-gray-400"><span className="font-semibold text-gray-300">Prompt:</span> {prompt}</p></div>
                      <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3 text-xs leading-5 text-gray-500"><span className="font-semibold text-gray-400">Bilmen gereken:</span> {note}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-8 grid gap-4 lg:grid-cols-2">
                  <PromptExample label="Seedance 2.5 · Kaynak videoda edit" result="Değişiklik tek, korunacak öğeler açık ve kaynak video doğrudan etiketlenmiş.">{'Edit @VIDEO_1: Add a photorealistic great white shark approaching from behind. Preserve the man’s identity, clothing, exact ocean environment, camera angle, lighting and original motion. Change only the requested action.'}</PromptExample>
                  <PromptExample label="H3 Max · Başlangıç görseli" result="Görsel yapısal başlangıç karesi olarak gönderilir; numaralı @ referansı gerekmez.">{'The people in the start image drop their equipment and begin a grounded karate fight in the same white lab. Preserve their faces, clothing, lighting, and camera viewpoint.'}</PromptExample>
                </div>
                <div className="mt-6"><Note title="Gerçek video edit konusunda beklenti" tone="amber">Üretken video modelleri klasik kurgu yazılımı gibi piksel kilitli çalışmaz. <strong className="text-white">Seedance 2.5 Edit</strong> kaynak klibi korumaya en uygun akıştır; <strong className="text-white">Seedance 2.0 Ref Edit</strong> daha fazla yeniden yorumlayabilir. H3 Max’te Extend Video kaynak klibi uzatır, Recast ise kişileri referans fotoğraflarıyla değiştirir. Gerçek kişi içeren girdiler sağlayıcı politikaları nedeniyle yine reddedilebilir.</Note></div>
              </section>

              <section id="help-models" className="scroll-mt-6 border-b border-white/[0.08] py-14">
                <SectionHeading eyebrow="05 · Modeller" title="Göreve göre model seç" description="Tek bir model her işte en doğru seçenek değildir. Aşağıdaki kartlar uygulamadaki desteklenen akış ve ayarları özetler." />
                <div className="mb-10 overflow-hidden rounded-2xl border border-violet-500/20 bg-violet-500/[0.05]">
                  <div className="border-b border-white/[0.08] px-5 py-4 sm:px-6">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><Video className="h-4 w-4" /></div>
                      <div>
                        <h3 className="text-sm font-bold text-white">Video için hangi modeli seçmeliyim?</h3>
                        <p className="mt-1 text-xs leading-5 text-gray-500">Önce yapmak istediğin işe en yakın satırı bul; modeli ve aksiyonu buna göre seç.</p>
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-white/[0.07]">
                    {[
                      ['Sıfırdan yeni video', 'Seedance 2.0 · Generate', 'Yeni bir klibi yalnızca metinden veya genel referanslardan üretmek için.'],
                      ['Kaynak videoyu yeniden yorumla', 'Seedance 2.0 · Ref Edit', 'Kaynak videodan yola çıkıp oranı, süreyi veya sahneyi daha serbest değiştirmek için. Birebir kare koruması bekleme.'],
                      ['Kaynak videoda kontrollü değişiklik', 'Seedance 2.5 Relaxed · Edit', 'Kişi, ortam, kamera ve mevcut hareketi mümkün olduğunca koruyup yalnızca istediğin öğeyi değiştirmek için.'],
                      ['Aynı videoyu uzat', 'Seedance 2.5 Relaxed · Extend', 'Kaynak klibin sonrasını veya öncesini aynı görsel devamlılıkla üretmek için.'],
                      ['Görseli hareketlendir', 'MiniMax H3 Max · Image to Video Max', 'İlk görseli otomatik başlangıç karesi olarak kullanmak; istersen ikinci görselle bitiş karesini de belirlemek için.'],
                      ['Görsel + video + ses referansı', 'Seedance · Generate / Edit', 'Birden fazla medya referansını birlikte kullanmak için. H3 Max → Reference to Video Max de görsel, video ve ses referanslarını birlikte destekler.'],
                    ].map(([goal, choice, reason]) => (
                      <div key={goal} className="grid gap-2 bg-[#111720]/70 px-5 py-4 sm:grid-cols-[1fr_220px_1.4fr] sm:items-start sm:gap-5 sm:px-6">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600 sm:hidden">Hedef</span>
                          <p className="mt-0.5 text-sm font-semibold text-white sm:mt-0">{goal}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600 sm:hidden">Model · Aksiyon</span>
                          <p className="mt-0.5 text-xs font-semibold leading-5 text-violet-300 sm:mt-0">{choice}</p>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-600 sm:hidden">Ne zaman?</span>
                          <p className="mt-0.5 text-xs leading-5 text-gray-400 sm:mt-0">{reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-start gap-3 border-t border-amber-500/15 bg-amber-500/[0.06] px-5 py-4 sm:px-6">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <p className="text-xs leading-5 text-gray-300"><strong className="text-white">Sıralama önemlidir:</strong> Önce model, aksiyon ve referans rollerini seç, sonra Enhance kullan. Enhance sonrasında model, aksiyon, Continue kaynağı veya referansları değiştirirsen eski promptla üretim engellenir. <strong className="text-white">Revert → tekrar Enhance</strong> ile yeni seçime uygun promptu hazırla.</p>
                  </div>
                </div>
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><ImageIcon className="h-4 w-4 text-amber-300" /> Görsel modelleri</h3>
                <div className="grid gap-4 lg:grid-cols-3">
                  <ModelCard name="Nano Banana Pro" badge="Detaylı brief" badgeTone="border-violet-400/20 bg-violet-500/10 text-violet-300" bestFor="Yoğun kompozisyon, çok öğeli yönlendirme ve yüksek çözünürlük">Yeni görsel ve çoklu referanslı edit destekler. 1K, 2K ve 4K çıktılar için; karmaşık brieflerde ilk tercihlerden biridir.</ModelCard>
                  <ModelCard name="Nano Banana 2.1" badge="Hızlı iterasyon" badgeTone="border-emerald-400/20 bg-emerald-500/10 text-emerald-300" bestFor="Fikirleri hızlı denemek, seri varyasyon ve genel image edit">Yeni görsel ve çoklu referanslı edit destekler. Kompozisyonu hızlı deneyip son yönü bulmak için uygundur.</ModelCard>
                  <ModelCard name="GPT Image 2.5 Sunburst" badge="Kalite ve şeffaflık" badgeTone="border-amber-400/20 bg-amber-500/10 text-amber-300" bestFor="Kimlik referanslarıyla görsel düzenleme">16 referansa kadar destekler. Modelin yanındaki kontrollerden Auto–Max kalite seçilebilir. Aspect Ratio → Custom size ile piksel cinsinden genişlik/yükseklik girilir; yanındaki ok düğmesi yönü değiştirir. Kenarlar 16’nın katı ve en fazla 3840 px; oran 1:3–3:1, toplam piksel sayısı 655.360–8.294.400 olmalıdır. Auto size seçeneğinde boyutu model belirler. Çıktı formatı PNG olarak sabittir. Arka plan Auto, moderation Low ve referans ayrıntısı model varsayılanıyla çalışır. Üretim öncesi tahmini çıktı maliyeti gösterilir; Auto kalite/boyutta aralık verilir, prompt ve referans ücretleri ayrıca eklenir. Kesin maliyet üretimden sonra kaydedilir. İlerleme yüzdesi tahminidir; 2560×1440 üzerindeki çözünürlükler deneyseldir.</ModelCard>
                </div>
                <h3 className="mb-4 mt-10 flex items-center gap-2 text-sm font-semibold text-white"><Film className="h-4 w-4 text-cyan-300" /> Video modelleri</h3>
                <div className="space-y-4">
                  <ModelCard name="Seedance 2.0" badge="Generate + Ref Edit + Continue" badgeTone="border-blue-400/20 bg-blue-500/10 text-blue-300" bestFor="Yeni video ve oranı/süresi değişebilen kaynak odaklı yeniden yorumlama">
                    <div className="grid gap-3 sm:grid-cols-3"><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Süre</span><span className="text-xs text-gray-300">4–15 saniye</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Kalite</span><span className="text-xs text-gray-300">480p · 720p · 1080p</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Edit etiketi</span><CodeTag>@VIDEO_1</CodeTag></div></div>
                    <p className="mt-4 text-xs text-gray-500">Ref Edit, kaynak videoyu güçlü bir referans olarak kullanır; birebir kare koruması garanti etmez. Uygulama etiketi sağlayıcı için gerekli biçime otomatik çevrilir.</p>
                  </ModelCard>
                  <ModelCard name="Seedance 2.5 Relaxed" badge="Generate + Edit + Continue + Extend" badgeTone="border-violet-400/20 bg-violet-500/10 text-violet-300" bestFor="Mevcut videoda en kaynak odaklı edit ve klip uzatma">
                    <div className="grid gap-3 sm:grid-cols-3"><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Süre</span><span className="text-xs text-gray-300">4–30 saniye · Auto</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Kalite</span><span className="text-xs text-gray-300">480p · 720p · 1080p</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Edit etiketi</span><CodeTag>@VIDEO_1</CodeTag></div></div>
                    <p className="mt-4 text-xs text-gray-500">Edit kaynak oranı ve süresiyle çalışır. Relaxed kanal daha esnek filtreyle gönderilir ve ek maliyetlidir; bu, tüm gerçek kişi editlerinin kabul edileceği anlamına gelmez.</p>
                  </ModelCard>
                  <ModelCard name="MiniMax H3 Max" badge="6 video aksiyonu" badgeTone="border-emerald-400/20 bg-emerald-500/10 text-emerald-300" bestFor="Text, Image, Reference to Video, Extend, Lip Sync ve Recast">
                    <div className="grid gap-3 sm:grid-cols-3"><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Süre</span><span className="text-xs text-gray-300">1–15s · Lip Sync/Recast kaynak süresi</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Kalite</span><span className="text-xs text-gray-300">480p · 768p · 1080p · desteklenen aksiyonlarda 2K</span></div><div><span className="block text-[10px] uppercase tracking-wider text-gray-600">Girdi</span><span className="text-xs text-gray-300">Seçili aksiyona göre görsel/video/ses</span></div></div>
                    <p className="mt-4 text-xs text-gray-500">Aksiyon, kalite ve süre seçenekleri birlikte güncellenir. Text/Image hedef sesle en az 2s ister. Extend süresi yeni eklenecek bölümdür. Lip Sync süresi sesi, Recast süresi kaynak videoyu takip eder.</p>
                  </ModelCard>
                </div>
                <div className="mt-6"><Note title="H3 seçimi her zaman Max’tir">H3 Max aksiyonunu menüden açıkça seç. Dosya eklemek seçili aksiyonu değiştirmez; desteklenmeyen girdiler için generation bar’da açıklama gösterilir.</Note></div>
              </section>

              <section id="help-prompts" className="scroll-mt-6 border-b border-white/[0.08] py-14">
                <SectionHeading eyebrow="06 · Prompt ve Enhance" title="Kısa isteğini yaz, detaylandırmayı Enhance’e bırak" description="Teknik prompt hazırlamana gerek yok. İstediğin sonucu basit dille yaz, referanslarını @ etiketiyle belirt ve Generate’dan önce mutlaka Enhance kullan." />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ['1', 'Dosyayı ekle', 'Kullanacağın görseli, videoyu veya sesi yükle.'], ['2', '@ ile belirt', 'Her referansın prompttaki görevini söyle.'], ['3', 'Basitçe yaz', 'İstediğin sonucu veya değişikliği anlat.'], ['4', 'Enhance kullan', 'Promptu seçilen modele uygun hale getir.'], ['5', 'Kontrol et ve üret', 'Enhance sonucunu kontrol edip Generate’a bas.'],
                  ].map(([number, title, text]) => (
                    <div key={number} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"><span className="text-[10px] font-bold text-violet-400">{number}</span><h3 className="mt-2 text-xs font-semibold text-white">{title}</h3><p className="mt-1.5 text-[11px] leading-5 text-gray-500">{text}</p></div>
                  ))}
                </div>
                <div className="mt-8 grid gap-5 lg:grid-cols-2">
                  <PromptExample label="Enhance öncesi · Fotoğraf edit" result="Kaynak ve değişiklik belli. Enhance, korunacak ayrıntıları ve modele uygun yapıyı ekler.">{'@REF_IMAGE_1 içindeki mavi paketi mat siyah yap. Logo ve arka plan aynı kalsın.'}</PromptExample>
                  <PromptExample label="Enhance öncesi · Video edit" result="Kaynak video ve ana aksiyon açık. Kamera, devamlılık ve fizik ayrıntılarını Enhance düzenler.">{'@VIDEO_1 içindeki yüzücünün arkasından gerçekçi bir köpekbalığı gelsin.'}</PromptExample>
                </div>
                <div className="mt-8 rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-5 sm:p-6">
                  <div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><WandSparkles className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold text-white">Enhance ne yapar?</h3><div className="mt-3 space-y-3 text-sm leading-6 text-gray-300"><p><strong className="text-white">Generate’dan önce mutlaka kullan:</strong> kısa isteğini seçtiğin modele uygun, daha anlaşılır ve üretime hazır bir prompta dönüştürür.</p><p><strong className="text-white">Referanslı üretimlerde:</strong> @ etiketleriyle belirttiğin görsel, video, kişi ve ses rollerini promptun doğru bölümlerine yerleştirir.</p><p><strong className="text-white">Fotoğraf ve video editinde:</strong> istediğin değişikliği detaylandırır; kaynak görüntüde korunması gereken kimlik, ortam ve devamlılığı daha açık hale getirir.</p><p>Enhance sonucu istediğin yönde değilse <strong className="text-white">Revert</strong> ile kısa orijinal promptuna dönebilirsin.</p></div></div></div>
                </div>
                <div className="mt-6"><Note title="Her aksiyonun Enhance talimatı farklıdır">Generate bağımsız yeni sahneyi ve referansların rollerini tarif eder. Edit/Ref Edit yalnız istenen değişiklikleri ve kaynakta korunacakları anlatır. Continue seçilen videonun son görünür anından başlayacak yeni aksiyonu tarif eder; önceki çekimi tekrar etmez.</Note></div>
                <div className="mt-4"><Note title="Enhance kullanmadan önce üç şeyi kontrol et" tone="amber">Doğru aksiyonu seç, gerekli dosyaları gerçekten ekle ve kullandığın referansları doğru @ etiketleriyle belirt. Enhance yanlış aksiyonu, eksik dosyayı veya hatalı referans rolünü kendi başına düzeltemez.</Note></div>
              </section>

              <section id="help-troubleshooting" className="scroll-mt-6 py-14">
                <SectionHeading eyebrow="07 · Sorun çözme" title="Sonuç beklediğin gibi değilse önce bunları kontrol et" description="Çoğu sorun prompttan önce yanlış aksiyon, eksik referans veya modele uymayan ayardan kaynaklanır." />
                <div className="space-y-3">
                  {[
                    ['Promptu nasıl yazmalıyım?', 'İstediğin sonucu basit dille yaz. Dosyaları @ menüsünden seç. H3 Image to Video’da başlangıç/bitiş karesini doğal dille, Reference to Video’da Image N / Video N / Audio N etiketleriyle an. Uzun teknik prompt hazırlama; Generate’dan önce Enhance kullan.'],
                    ['Video kapağı veya yeni görsel fikrim hazır değil', 'Videonun konusunu ya da basit fikrini prompt alanına yaz. Brainstorm’a bas, kategori ve fikir sayısını seç. Maliyet önizlemesini kontrol edip Generate’e bas; fikirler ve görseller arka arkaya hazırlanır.'],
                    ['Kaynak yerine bambaşka video oluştu', 'Seedance 2.5’te Generate değil Edit seç. Seedance 2.0’da Ref Edit seç. Video dosyasının ekli ve promptta @VIDEO_1 olarak anıldığından emin ol.'],
                    ['Etiket yazdım ama referans kullanılmadı', '@ etiketi dosya yüklemez. İlgili dosya referans çubuğunda görünmeli. H3 Max aksiyonunun o medya türünü desteklediğini ve kare rollerini kontrol et.'],
                    ['Kişinin yüzü veya kıyafeti değişti', 'Net ve benzer dönemden birkaç fotoğraf ekleyip hepsine Me rolü ver. “Preserve identity, facial features, hair and wardrobe” kilidini prompta ekle.'],
                    ['First Frame seçemiyorum', 'H3 Max’te Image to Video veya Reference to Video seç, ardından görsel menüsünden First/Last Frame rolünü ata. Seedance’te 1st/2nd Person rolüyle frame rolünü aynı istekte karıştırma.'],
                    ['H3 Generate düğmesi pasif', 'Generation bar’daki açıklamayı kontrol et: seçili aksiyonun gerekli medya türleri ve promptu eksik olabilir. Süre/kalite seçenekleri aksiyona göre değişir.'],
                    ['H3 ile video referansı kullanamıyorum', 'Hareket referansı için Reference to Video Max; klibi uzatmak için Extend Video Max; kişileri değiştirmek için Recast seç.'],
                    ['Invalid parameters hatası alıyorum', 'Modelin kalite ve süre seçeneklerini kontrol et. Seedance: 480p/720p/1080p; H3 Max seçenekleri aksiyona göre değişir. Text/Image/Reference: 480p/768p/1080p; Extend/Lip Sync ayrıca 2K; Recast: 768p/1080p. Edit aksiyonlarında kaynak video zorunludur.'],
                    ['Gerçek kişi girdisi reddedildi', 'Relaxed veya safety-checker ayarı tüm sağlayıcı politikalarını kaldırmaz. Sağlayıcı gerçek kişi, haklar veya güvenlik kontrolleri nedeniyle isteği reddedebilir.'],
                    ['Sonuç çok karikatürize / fizik zayıf', '“Photorealistic” kelimesini tekrarlamak yerine gerçek kamera davranışı, ışık eşleşmesi, ölçü, ağırlık, su/temas fiziği ve tek çekim devamlılığı gibi gözlemlenebilir özellikleri yaz.'],
                    ['Prompt çok uzadı ve talimatlar karıştı', 'Tekrarları çıkar. Kaynak → değişiklik → korunacaklar → kamera/zaman → ses sırasına dön. Her zaman çizelgesi klip süresine gerçekten sığmalı.'],
                  ].map(([title, answer], index) => (
                    <details key={title} defaultOpen={index < 2} className="group rounded-2xl border border-white/[0.08] bg-[#111720]"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 text-sm font-semibold text-gray-200 marker:hidden sm:px-5"><span>{title}</span><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-gray-500 transition-transform group-open:rotate-45">+</span></summary><div className="border-t border-white/[0.07] px-4 py-4 text-sm leading-6 text-gray-400 sm:px-5">{answer}</div></details>
                  ))}
                </div>
                <div className="mt-8 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-violet-500/[0.09] to-cyan-500/[0.04] p-6 text-center sm:p-8"><Play className="mx-auto h-6 w-6 text-violet-300" /><h3 className="mt-4 text-base font-bold text-white">Enhance kullandıktan sonra Generate</h3><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-400">Doğru model ve aksiyon seçili mi? Dosyalar ekli ve @ referans rolleri açık mı? Kısa isteğini yazıp Enhance kullandın mı? Hepsi tamamsa üretime hazırsın.</p></div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
