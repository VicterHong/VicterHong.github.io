/**
 * Terjemahan gerbang verifikasi.
 *
 * ── KENAPA BERKAS INI ADA ──────────────────────────────────────────────────
 *
 * Sebelumnya teks gate ditulis langsung dalam bahasa Indonesia di HTML dan JS.
 * Akibatnya pengunjung dari Jepang, Jerman, atau Brasil melihat halaman
 * verifikasi berbahasa Indonesia — padahal isi situsnya sendiri berbahasa
 * Indonesia dan mereka mungkin tidak paham.
 *
 * Cloudflare mengatasi ini dengan mendeteksi bahasa dari header
 * Accept-Language (bahasa yang dikirim browser). Kita tidak punya akses ke
 * header itu dari sisi klien, TAPI kita bisa membaca sumber yang sama yang
 * dipakai browser untuk mengisinya: `navigator.languages`.
 *
 * ── CARA KERJA DETEKSI ─────────────────────────────────────────────────────
 *
 *   1. navigator.languages  → ["id-ID", "id", "en-US", "en"]  (urutan preferensi)
 *   2. Cocokkan persis dulu ("id-id"), lalu kode 2 huruf ("id")
 *   3. Kalau tidak ada yang cocok → Inggris (sama seperti Cloudflare)
 *
 * Urutan preferensi PENTING: pengunjung dengan ["en-US","id-ID"] memilih
 * Inggris, bukan Indonesia, karena itu yang dia taruh pertama.
 *
 * ── DAFTAR BAHASA ──────────────────────────────────────────────────────────
 *
 * Persis daftar resmi Turnstile (reference/supported-languages), supaya
 * bahasa yang kita tampilkan tidak pernah berbeda dari bahasa widget-nya.
 * Sumber: developers.cloudflare.com/turnstile/reference/supported-languages
 */

(function () {
'use strict';

/** Kode bahasa yang didukung Turnstile + terjemahannya. */
const MESSAGES = {
  'en': {
    title: 'Verifying you are human',
    lead: 'This website uses a security service to protect against malicious bots. This page is displayed while we verify that you are not a bot.',
    success: 'Verification successful. Waiting for response from',
    noscript: 'Enable JavaScript and cookies to continue',
    retry: 'Verification could not load.',
    retryLink: 'Reload page',
      lama: 'Verification is taking longer than expected.',
      lamaSaran: 'Check your Internet connection and refresh the page if the issue persists.',
    rayId: 'Ray ID',
    footer: 'Performance and Security by',
    privacy: 'Privacy',
    ariaBusy: 'Verification in progress'
  },
  'id': {
    title: 'Melakukan verifikasi keamanan',
    lead: 'Situs web menggunakan layanan keamanan untuk melindungi dari bot jahat. Halaman ini ditunjukkan semasa kami memverifikasi bahwa Anda bukan bot.',
    success: 'Verifikasi berhasil. Menunggu response dari',
    noscript: 'Aktifkan JavaScript dan cookie untuk melanjutkan',
    retry: 'Verifikasi tidak dapat dimuat.',
    retryLink: 'Muat ulang halaman',
      lama: 'Verifikasi memakan waktu lebih lama dari biasanya.',
      lamaSaran: 'Periksa koneksi internet Anda dan muat ulang halaman jika masalah berlanjut.',
    rayId: 'Ray ID',
    footer: 'Performa dan Keamanan dari',
    privacy: 'Privasi',
    ariaBusy: 'Verifikasi sedang berjalan'
  },
  'ar': {
    title: 'جارٍ التحقق من أنك إنسان',
    lead: 'يستخدم هذا الموقع خدمة أمنية للحماية من الروبوتات الضارة. تُعرض هذه الصفحة أثناء التحقق من أنك لست روبوتًا.',
    success: 'تم التحقق بنجاح. في انتظار الرد من',
    noscript: 'فعّل JavaScript وملفات تعريف الارتباط للمتابعة',
    retry: 'تعذّر تحميل التحقق.',
    retryLink: 'إعادة تحميل الصفحة',
      lama: 'يستغرق التحقق وقتًا أطول من المتوقع.',
      lamaSaran: 'تحقق من اتصالك بالإنترنت وأعد تحميل الصفحة إذا استمرت المشكلة.',
    rayId: 'معرّف الطلب',
    footer: 'الأداء والأمان من',
    privacy: 'الخصوصية',
    ariaBusy: 'التحقق قيد التنفيذ'
  },
  'bg': {
    title: 'Проверяваме дали сте човек',
    lead: 'Този сайт използва услуга за сигурност, за да се предпази от злонамерени ботове. Тази страница се показва, докато проверяваме, че не сте бот.',
    success: 'Проверката е успешна. Изчакване на отговор от',
    noscript: 'Активирайте JavaScript и бисквитки, за да продължите',
    retry: 'Проверката не можа да се зареди.',
    retryLink: 'Презареди страницата',
      lama: 'Проверката отнема повече време от очакваното.',
      lamaSaran: 'Проверете интернет връзката си и презаредете страницата, ако проблемът продължава.',
    rayId: 'Ray ID',
    footer: 'Производителност и сигурност от',
    privacy: 'Поверителност',
    ariaBusy: 'Проверката е в ход'
  },
  'zh': {
    title: '正在验证您是真人',
    lead: '本网站使用安全服务来防范恶意机器人。在我们验证您不是机器人期间，会显示此页面。',
    success: '验证成功。正在等待来自以下网站的响应：',
    noscript: '请启用 JavaScript 和 Cookie 以继续',
    retry: '无法加载验证。',
    retryLink: '重新加载页面',
      lama: '验证耗时比预期更长。',
      lamaSaran: '请检查您的网络连接，如果问题仍然存在，请刷新页面。',
    rayId: 'Ray ID',
    footer: '性能与安全由以下提供：',
    privacy: '隐私',
    ariaBusy: '正在验证'
  },
  'hr': {
    title: 'Provjeravamo jeste li vi čovjek',
    lead: 'Ovo web-mjesto koristi sigurnosnu uslugu za zaštitu od zlonamjernih botova. Ova se stranica prikazuje dok provjeravamo da niste bot.',
    success: 'Provjera uspješna. Čekamo odgovor od',
    noscript: 'Omogućite JavaScript i kolačiće za nastavak',
    retry: 'Provjeru nije bilo moguće učitati.',
    retryLink: 'Ponovno učitaj stranicu',
      lama: 'Provjera traje dulje od očekivanog.',
      lamaSaran: 'Provjerite internetsku vezu i ponovno učitajte stranicu ako se problem nastavi.',
    rayId: 'Ray ID',
    footer: 'Performanse i sigurnost od',
    privacy: 'Privatnost',
    ariaBusy: 'Provjera je u tijeku'
  },
  'cs': {
    title: 'Ověřujeme, že jste člověk',
    lead: 'Tento web používá bezpečnostní službu k ochraně před škodlivými roboty. Tato stránka se zobrazuje, dokud ověřujeme, že nejste robot.',
    success: 'Ověření proběhlo úspěšně. Čekáme na odpověď od',
    noscript: 'Chcete-li pokračovat, povolte JavaScript a soubory cookie',
    retry: 'Ověření se nepodařilo načíst.',
    retryLink: 'Znovu načíst stránku',
      lama: 'Ověření trvá déle, než se očekávalo.',
      lamaSaran: 'Zkontrolujte připojení k internetu a pokud problém přetrvává, obnovte stránku.',
    rayId: 'Ray ID',
    footer: 'Výkon a zabezpečení od',
    privacy: 'Soukromí',
    ariaBusy: 'Probíhá ověřování'
  },
  'da': {
    title: 'Vi bekræfter, at du er et menneske',
    lead: 'Dette websted bruger en sikkerhedstjeneste til at beskytte mod ondsindede bots. Denne side vises, mens vi bekræfter, at du ikke er en bot.',
    success: 'Bekræftelse lykkedes. Venter på svar fra',
    noscript: 'Aktivér JavaScript og cookies for at fortsætte',
    retry: 'Bekræftelsen kunne ikke indlæses.',
    retryLink: 'Genindlæs siden',
      lama: 'Verificeringen tager længere tid end forventet.',
      lamaSaran: 'Tjek din internetforbindelse, og genindlæs siden, hvis problemet fortsætter.',
    rayId: 'Ray ID',
    footer: 'Ydeevne og sikkerhed fra',
    privacy: 'Privatliv',
    ariaBusy: 'Bekræftelse i gang'
  },
  'nl': {
    title: 'We controleren of u een mens bent',
    lead: 'Deze website gebruikt een beveiligingsdienst om te beschermen tegen kwaadaardige bots. Deze pagina wordt weergegeven terwijl we controleren of u geen bot bent.',
    success: 'Verificatie geslaagd. Wachten op reactie van',
    noscript: 'Schakel JavaScript en cookies in om door te gaan',
    retry: 'Verificatie kon niet worden geladen.',
    retryLink: 'Pagina opnieuw laden',
      lama: 'Verificatie duurt langer dan verwacht.',
      lamaSaran: 'Controleer je internetverbinding en herlaad de pagina als het probleem aanhoudt.',
    rayId: 'Ray ID',
    footer: 'Prestaties en beveiliging van',
    privacy: 'Privacy',
    ariaBusy: 'Verificatie wordt uitgevoerd'
  },
  'fa': {
    title: 'در حال بررسی اینکه شما انسان هستید',
    lead: 'این وب‌سایت از یک سرویس امنیتی برای محافظت در برابر ربات‌های مخرب استفاده می‌کند. این صفحه در حالی نمایش داده می‌شود که بررسی می‌کنیم شما ربات نیستید.',
    success: 'بررسی با موفقیت انجام شد. در انتظار پاسخ از',
    noscript: 'برای ادامه، JavaScript و کوکی‌ها را فعال کنید',
    retry: 'بررسی بارگذاری نشد.',
    retryLink: 'بارگذاری مجدد صفحه',
      lama: 'تأیید بیشتر از حد انتظار طول می‌کشد.',
      lamaSaran: 'اتصال اینترنت خود را بررسی کنید و اگر مشکل ادامه داشت صفحه را دوباره بارگذاری کنید.',
    rayId: 'شناسه درخواست',
    footer: 'کارایی و امنیت از',
    privacy: 'حریم خصوصی',
    ariaBusy: 'بررسی در حال انجام است'
  },
  'fi': {
    title: 'Vahvistamme, että olet ihminen',
    lead: 'Tämä verkkosivusto käyttää turvapalvelua suojautuakseen haitallisilta boteilta. Tämä sivu näytetään, kun vahvistamme, ettet ole botti.',
    success: 'Vahvistus onnistui. Odotetaan vastausta kohteesta',
    noscript: 'Ota JavaScript ja evästeet käyttöön jatkaaksesi',
    retry: 'Vahvistusta ei voitu ladata.',
    retryLink: 'Lataa sivu uudelleen',
      lama: 'Vahvistus kestää odotettua kauemmin.',
      lamaSaran: 'Tarkista internetyhteytesi ja päivitä sivu, jos ongelma jatkuu.',
    rayId: 'Ray ID',
    footer: 'Suorituskyky ja tietoturva:',
    privacy: 'Tietosuoja',
    ariaBusy: 'Vahvistus käynnissä'
  },
  'fr': {
    title: 'Nous vérifions que vous êtes humain',
    lead: "Ce site utilise un service de sécurité pour se protéger contre les bots malveillants. Cette page s'affiche pendant que nous vérifions que vous n'êtes pas un bot.",
    success: 'Vérification réussie. En attente de la réponse de',
    noscript: 'Activez JavaScript et les cookies pour continuer',
    retry: 'La vérification n’a pas pu se charger.',
    retryLink: 'Recharger la page',
      lama: 'La vérification prend plus de temps que prévu.',
      lamaSaran: 'Vérifiez votre connexion Internet et actualisez la page si le problème persiste.',
    rayId: 'Ray ID',
    footer: 'Performance et sécurité par',
    privacy: 'Confidentialité',
    ariaBusy: 'Vérification en cours'
  },
  'de': {
    title: 'Wir überprüfen, ob Sie ein Mensch sind',
    lead: 'Diese Website verwendet einen Sicherheitsdienst zum Schutz vor bösartigen Bots. Diese Seite wird angezeigt, während wir überprüfen, dass Sie kein Bot sind.',
    success: 'Überprüfung erfolgreich. Warten auf Antwort von',
    noscript: 'Aktivieren Sie JavaScript und Cookies, um fortzufahren',
    retry: 'Überprüfung konnte nicht geladen werden.',
    retryLink: 'Seite neu laden',
      lama: 'Die Überprüfung dauert länger als erwartet.',
      lamaSaran: 'Überprüfen Sie Ihre Internetverbindung und laden Sie die Seite neu, wenn das Problem weiterhin besteht.',
    rayId: 'Ray ID',
    footer: 'Leistung und Sicherheit von',
    privacy: 'Datenschutz',
    ariaBusy: 'Überprüfung läuft'
  },
  'el': {
    title: 'Επαληθεύουμε ότι είστε άνθρωπος',
    lead: 'Αυτός ο ιστότοπος χρησιμοποιεί υπηρεσία ασφαλείας για προστασία από κακόβουλα bots. Αυτή η σελίδα εμφανίζεται όσο επαληθεύουμε ότι δεν είστε bot.',
    success: 'Η επαλήθευση ήταν επιτυχής. Αναμονή απάντησης από',
    noscript: 'Ενεργοποιήστε τη JavaScript και τα cookies για να συνεχίσετε',
    retry: 'Δεν ήταν δυνατή η φόρτωση της επαλήθευσης.',
    retryLink: 'Επαναφόρτωση σελίδας',
      lama: 'Η επαλήθευση διαρκεί περισσότερο από το αναμενόμενο.',
      lamaSaran: 'Ελέγξτε τη σύνδεσή σας στο διαδίκτυο και ανανεώστε τη σελίδα αν το πρόβλημα παραμένει.',
    rayId: 'Ray ID',
    footer: 'Απόδοση και ασφάλεια από',
    privacy: 'Απόρρητο',
    ariaBusy: 'Η επαλήθευση είναι σε εξέλιξη'
  },
  'he': {
    title: 'אנו מאמתים שאתם בני אדם',
    lead: 'אתר זה משתמש בשירות אבטחה כדי להגן מפני בוטים זדוניים. דף זה מוצג בזמן שאנו מאמתים שאינכם בוט.',
    success: 'האימות הצליח. ממתין לתגובה מ-',
    noscript: 'הפעילו JavaScript וקובצי Cookie כדי להמשיך',
    retry: 'לא ניתן היה לטעון את האימות.',
    retryLink: 'טען מחדש את הדף',
      lama: 'האימות אורך יותר מהצפוי.',
      lamaSaran: 'בדוק את חיבור האינטרנט שלך ורענן את הדף אם הבעיה נמשכת.',
    rayId: 'מזהה בקשה',
    footer: 'ביצועים ואבטחה מאת',
    privacy: 'פרטיות',
    ariaBusy: 'האימות מתבצע'
  },
  'hi': {
    title: 'हम जाँच रहे हैं कि आप मानव हैं',
    lead: 'यह वेबसाइट दुर्भावनापूर्ण बॉट्स से सुरक्षा के लिए एक सुरक्षा सेवा का उपयोग करती है। यह पृष्ठ तब दिखाया जाता है जब हम जाँच करते हैं कि आप बॉट नहीं हैं।',
    success: 'सत्यापन सफल। प्रतिक्रिया की प्रतीक्षा की जा रही है',
    noscript: 'जारी रखने के लिए JavaScript और कुकीज़ सक्षम करें',
    retry: 'सत्यापन लोड नहीं हो सका।',
    retryLink: 'पृष्ठ पुनः लोड करें',
      lama: 'सत्यापन अपेक्षा से अधिक समय ले रहा है।',
      lamaSaran: 'अपना इंटरनेट कनेक्शन जांचें और समस्या बनी रहने पर पेज रीफ्रेश करें।',
    rayId: 'Ray ID',
    footer: 'प्रदर्शन और सुरक्षा द्वारा',
    privacy: 'गोपनीयता',
    ariaBusy: 'सत्यापन जारी है'
  },
  'hu': {
    title: 'Ellenőrizzük, hogy Ön ember-e',
    lead: 'Ez a webhely biztonsági szolgáltatást használ a rosszindulatú botok elleni védelemhez. Ez az oldal akkor jelenik meg, amíg ellenőrizzük, hogy nem bot.',
    success: 'Az ellenőrzés sikeres. Várakozás válaszra innen:',
    noscript: 'A folytatáshoz engedélyezze a JavaScriptet és a cookie-kat',
    retry: 'Az ellenőrzést nem sikerült betölteni.',
    retryLink: 'Oldal újratöltése',
      lama: 'Az ellenőrzés a vártnál tovább tart.',
      lamaSaran: 'Ellenőrizze az internetkapcsolatát, és ha a probléma továbbra is fennáll, töltse újra az oldalt.',
    rayId: 'Ray ID',
    footer: 'Teljesítmény és biztonság:',
    privacy: 'Adatvédelem',
    ariaBusy: 'Ellenőrzés folyamatban'
  },
  'it': {
    title: 'Stiamo verificando che tu sia una persona',
    lead: 'Questo sito utilizza un servizio di sicurezza per proteggersi da bot dannosi. Questa pagina viene mostrata mentre verifichiamo che tu non sia un bot.',
    success: 'Verifica riuscita. In attesa di risposta da',
    noscript: 'Attiva JavaScript e i cookie per continuare',
    retry: 'Impossibile caricare la verifica.',
    retryLink: 'Ricarica la pagina',
      lama: 'La verifica sta richiedendo più tempo del previsto.',
      lamaSaran: 'Controlla la connessione a Internet e ricarica la pagina se il problema persiste.',
    rayId: 'Ray ID',
    footer: 'Prestazioni e sicurezza di',
    privacy: 'Privacy',
    ariaBusy: 'Verifica in corso'
  },
  'ja': {
    title: 'あなたが人間であることを確認しています',
    lead: 'このウェブサイトは、悪意のあるボットから保護するためにセキュリティサービスを使用しています。このページは、あなたがボットでないことを確認している間に表示されます。',
    success: '確認に成功しました。応答を待っています：',
    noscript: '続行するには JavaScript と Cookie を有効にしてください',
    retry: '確認を読み込めませんでした。',
    retryLink: 'ページを再読み込み',
      lama: '確認に予想以上の時間がかかっています。',
      lamaSaran: 'インターネット接続を確認し、問題が解決しない場合はページを再読み込みしてください。',
    rayId: 'Ray ID',
    footer: 'パフォーマンスとセキュリティ提供：',
    privacy: 'プライバシー',
    ariaBusy: '確認中です'
  },
  'ko': {
    title: '사용자가 사람인지 확인하는 중입니다',
    lead: '이 웹사이트는 악성 봇으로부터 보호하기 위해 보안 서비스를 사용합니다. 이 페이지는 사용자가 봇이 아닌지 확인하는 동안 표시됩니다.',
    success: '확인에 성공했습니다. 응답을 기다리는 중:',
    noscript: '계속하려면 JavaScript와 쿠키를 활성화하세요',
    retry: '확인을 불러올 수 없습니다.',
    retryLink: '페이지 새로고침',
      lama: '확인이 예상보다 오래 걸리고 있습니다.',
      lamaSaran: '인터넷 연결을 확인하고 문제가 계속되면 페이지를 새로 고침하세요.',
    rayId: 'Ray ID',
    footer: '성능 및 보안 제공:',
    privacy: '개인정보',
    ariaBusy: '확인 중입니다'
  },
  'lt': {
    title: 'Tikriname, ar esate žmogus',
    lead: 'Ši svetainė naudoja saugos paslaugą, kad apsisaugotų nuo kenkėjiškų robotų. Šis puslapis rodomas, kol tikriname, ar nesate robotas.',
    success: 'Patvirtinimas sėkmingas. Laukiama atsakymo iš',
    noscript: 'Norėdami tęsti, įjunkite „JavaScript“ ir slapukus',
    retry: 'Nepavyko įkelti patvirtinimo.',
    retryLink: 'Įkelti puslapį iš naujo',
      lama: 'Patvirtinimas trunka ilgiau nei tikėtasi.',
      lamaSaran: 'Patikrinkite interneto ryšį ir jei problema išlieka, įkelkite puslapį iš naujo.',
    rayId: 'Ray ID',
    footer: 'Našumas ir saugumas:',
    privacy: 'Privatumas',
    ariaBusy: 'Vyksta patvirtinimas'
  },
  'ms': {
    title: 'Kami mengesahkan anda manusia',
    lead: 'Laman web ini menggunakan perkhidmatan keselamatan untuk melindungi daripada bot berniat jahat. Halaman ini dipaparkan semasa kami mengesahkan anda bukan bot.',
    success: 'Pengesahan berjaya. Menunggu respons daripada',
    noscript: 'Dayakan JavaScript dan kuki untuk meneruskan',
    retry: 'Pengesahan tidak dapat dimuatkan.',
    retryLink: 'Muat semula halaman',
      lama: 'Pengesahan mengambil masa lebih lama daripada biasa.',
      lamaSaran: 'Semak sambungan internet anda dan muat semula halaman jika masalah berterusan.',
    rayId: 'Ray ID',
    footer: 'Prestasi dan Keselamatan oleh',
    privacy: 'Privasi',
    ariaBusy: 'Pengesahan sedang berjalan'
  },
  'nb': {
    title: 'Vi bekrefter at du er et menneske',
    lead: 'Dette nettstedet bruker en sikkerhetstjeneste for å beskytte mot ondsinnede roboter. Denne siden vises mens vi bekrefter at du ikke er en robot.',
    success: 'Bekreftelsen var vellykket. Venter på svar fra',
    noscript: 'Aktiver JavaScript og informasjonskapsler for å fortsette',
    retry: 'Bekreftelsen kunne ikke lastes.',
    retryLink: 'Last inn siden på nytt',
      lama: 'Verifiseringen tar lengre tid enn forventet.',
      lamaSaran: 'Sjekk internettforbindelsen din og last inn siden på nytt hvis problemet vedvarer.',
    rayId: 'Ray ID',
    footer: 'Ytelse og sikkerhet fra',
    privacy: 'Personvern',
    ariaBusy: 'Bekreftelse pågår'
  },
  'pl': {
    title: 'Sprawdzamy, czy jesteś człowiekiem',
    lead: 'Ta witryna używa usługi bezpieczeństwa do ochrony przed złośliwymi botami. Ta strona jest wyświetlana, gdy sprawdzamy, czy nie jesteś botem.',
    success: 'Weryfikacja zakończona pomyślnie. Oczekiwanie na odpowiedź od',
    noscript: 'Włącz JavaScript i pliki cookie, aby kontynuować',
    retry: 'Nie udało się załadować weryfikacji.',
    retryLink: 'Odśwież stronę',
      lama: 'Weryfikacja trwa dłużej niż oczekiwano.',
      lamaSaran: 'Sprawdź połączenie z internetem i odśwież stronę, jeśli problem nadal występuje.',
    rayId: 'Ray ID',
    footer: 'Wydajność i bezpieczeństwo od',
    privacy: 'Prywatność',
    ariaBusy: 'Trwa weryfikacja'
  },
  'pt': {
    title: 'Estamos verificando que você é humano',
    lead: 'Este site usa um serviço de segurança para se proteger contra bots maliciosos. Esta página é exibida enquanto verificamos que você não é um bot.',
    success: 'Verificação bem-sucedida. Aguardando resposta de',
    noscript: 'Ative o JavaScript e os cookies para continuar',
    retry: 'Não foi possível carregar a verificação.',
    retryLink: 'Recarregar página',
      lama: 'A verificação está demorando mais que o esperado.',
      lamaSaran: 'Verifique sua conexão com a internet e recarregue a página se o problema persistir.',
    rayId: 'Ray ID',
    footer: 'Desempenho e segurança por',
    privacy: 'Privacidade',
    ariaBusy: 'Verificação em andamento'
  },
  'ro': {
    title: 'Verificăm dacă sunteți o persoană',
    lead: 'Acest site folosește un serviciu de securitate pentru a se proteja împotriva roboților rău intenționați. Această pagină este afișată în timp ce verificăm că nu sunteți un robot.',
    success: 'Verificare reușită. Se așteaptă răspuns de la',
    noscript: 'Activați JavaScript și cookie-urile pentru a continua',
    retry: 'Verificarea nu a putut fi încărcată.',
    retryLink: 'Reîncarcă pagina',
      lama: 'Verificarea durează mai mult decât de obicei.',
      lamaSaran: 'Verificați conexiunea la internet și reîncărcați pagina dacă problema persistă.',
    rayId: 'Ray ID',
    footer: 'Performanță și securitate de la',
    privacy: 'Confidențialitate',
    ariaBusy: 'Verificare în curs'
  },
  'ru': {
    title: 'Проверяем, что вы человек',
    lead: 'Этот сайт использует службу безопасности для защиты от вредоносных ботов. Эта страница отображается, пока мы проверяем, что вы не бот.',
    success: 'Проверка пройдена. Ожидание ответа от',
    noscript: 'Включите JavaScript и файлы cookie, чтобы продолжить',
    retry: 'Не удалось загрузить проверку.',
    retryLink: 'Перезагрузить страницу',
      lama: 'Проверка занимает больше времени, чем ожидалось.',
      lamaSaran: 'Проверьте подключение к интернету и обновите страницу, если проблема не исчезнет.',
    rayId: 'Ray ID',
    footer: 'Производительность и безопасность от',
    privacy: 'Конфиденциальность',
    ariaBusy: 'Идёт проверка'
  },
  'sr': {
    title: 'Проверавамо да ли сте људско биће',
    lead: 'Овај сајт користи безбедносну услугу за заштиту од злонамерних ботова. Ова страница се приказује док проверавамо да нисте бот.',
    success: 'Провера је успешна. Чекамо одговор од',
    noscript: 'Омогућите JavaScript и колачиће да наставите',
    retry: 'Провера није могла да се учита.',
    retryLink: 'Поново учитај страницу',
      lama: 'Провера траје дуже од очекиваног.',
      lamaSaran: 'Проверите интернет везу и поново учитајте страницу ако се проблем настави.',
    rayId: 'Ray ID',
    footer: 'Перформансе и безбедност од',
    privacy: 'Приватност',
    ariaBusy: 'Провера је у току'
  },
  'sk': {
    title: 'Overujeme, či ste človek',
    lead: 'Táto webová lokalita používa bezpečnostnú službu na ochranu pred škodlivými robotmi. Táto stránka sa zobrazuje, kým overujeme, že nie ste robot.',
    success: 'Overenie bolo úspešné. Čakáme na odpoveď od',
    noscript: 'Ak chcete pokračovať, povoľte JavaScript a súbory cookie',
    retry: 'Overenie sa nepodarilo načítať.',
    retryLink: 'Znovu načítať stránku',
      lama: 'Overenie trvá dlhšie, ako sa očakávalo.',
      lamaSaran: 'Skontrolujte internetové pripojenie a ak problém pretrváva, obnovte stránku.',
    rayId: 'Ray ID',
    footer: 'Výkon a zabezpečenie od',
    privacy: 'Súkromie',
    ariaBusy: 'Prebieha overovanie'
  },
  'sl': {
    title: 'Preverjamo, ali ste človek',
    lead: 'To spletno mesto uporablja varnostno storitev za zaščito pred zlonamernimi boti. Ta stran je prikazana, medtem ko preverjamo, da niste bot.',
    success: 'Preverjanje je uspelo. Čakanje na odgovor od',
    noscript: 'Za nadaljevanje omogočite JavaScript in piškotke',
    retry: 'Preverjanja ni bilo mogoče naložiti.',
    retryLink: 'Ponovno naloži stran',
      lama: 'Preverjanje traja dlje od pričakovanega.',
      lamaSaran: 'Preverite internetno povezavo in znova naložite stran, če se težava nadaljuje.',
    rayId: 'Ray ID',
    footer: 'Zmogljivost in varnost od',
    privacy: 'Zasebnost',
    ariaBusy: 'Preverjanje poteka'
  },
  'es': {
    title: 'Estamos verificando que eres humano',
    lead: 'Este sitio web utiliza un servicio de seguridad para protegerse de bots maliciosos. Esta página se muestra mientras verificamos que no eres un bot.',
    success: 'Verificación correcta. Esperando respuesta de',
    noscript: 'Activa JavaScript y las cookies para continuar',
    retry: 'No se pudo cargar la verificación.',
    retryLink: 'Recargar página',
      lama: 'La verificación está tardando más de lo esperado.',
      lamaSaran: 'Comprueba tu conexión a Internet y recarga la página si el problema persiste.',
    rayId: 'Ray ID',
    footer: 'Rendimiento y seguridad por',
    privacy: 'Privacidad',
    ariaBusy: 'Verificación en curso'
  },
  'sv': {
    title: 'Vi verifierar att du är en människa',
    lead: 'Den här webbplatsen använder en säkerhetstjänst för att skydda mot skadliga botar. Den här sidan visas medan vi verifierar att du inte är en bot.',
    success: 'Verifieringen lyckades. Väntar på svar från',
    noscript: 'Aktivera JavaScript och cookies för att fortsätta',
    retry: 'Verifieringen kunde inte läsas in.',
    retryLink: 'Ladda om sidan',
      lama: 'Verifieringen tar längre tid än väntat.',
      lamaSaran: 'Kontrollera din internetanslutning och ladda om sidan om problemet kvarstår.',
    rayId: 'Ray ID',
    footer: 'Prestanda och säkerhet från',
    privacy: 'Integritet',
    ariaBusy: 'Verifiering pågår'
  },
  'tl': {
    title: 'Bine-verify namin na tao ka',
    lead: 'Gumagamit ang website na ito ng serbisyong pangseguridad para maprotektahan laban sa mapaminsalang bot. Ipinapakita ang pahinang ito habang bine-verify namin na hindi ka bot.',
    success: 'Tagumpay ang verification. Naghihintay ng tugon mula sa',
    noscript: 'I-enable ang JavaScript at cookies para magpatuloy',
    retry: 'Hindi ma-load ang verification.',
    retryLink: 'I-reload ang pahina',
      lama: 'Mas matagal ang pagpapatunay kaysa inaasahan.',
      lamaSaran: 'Suriin ang iyong koneksyon sa internet at i-refresh ang pahina kung magpatuloy ang problema.',
    rayId: 'Ray ID',
    footer: 'Performance at Seguridad mula sa',
    privacy: 'Privacy',
    ariaBusy: 'Kasalukuyang nagbe-verify'
  },
  'th': {
    title: 'เรากำลังตรวจสอบว่าคุณเป็นมนุษย์',
    lead: 'เว็บไซต์นี้ใช้บริการด้านความปลอดภัยเพื่อป้องกันบอทที่เป็นอันตราย หน้านี้จะแสดงในขณะที่เราตรวจสอบว่าคุณไม่ใช่บอท',
    success: 'ตรวจสอบสำเร็จ กำลังรอการตอบกลับจาก',
    noscript: 'เปิดใช้งาน JavaScript และคุกกี้เพื่อดำเนินการต่อ',
    retry: 'ไม่สามารถโหลดการตรวจสอบได้',
    retryLink: 'โหลดหน้าใหม่',
      lama: 'การยืนยันใช้เวลานานกว่าที่คาดไว้',
      lamaSaran: 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตของคุณและรีเฟรชหน้าเว็บหากปัญหายังคงอยู่',
    rayId: 'Ray ID',
    footer: 'ประสิทธิภาพและความปลอดภัยโดย',
    privacy: 'ความเป็นส่วนตัว',
    ariaBusy: 'กำลังตรวจสอบ'
  },
  'tr': {
    title: 'İnsan olduğunuzu doğruluyoruz',
    lead: 'Bu web sitesi kötü amaçlı botlara karşı korunmak için bir güvenlik hizmeti kullanır. Bu sayfa, bot olmadığınızı doğrularken gösterilir.',
    success: 'Doğrulama başarılı. Yanıt bekleniyor:',
    noscript: 'Devam etmek için JavaScript ve çerezleri etkinleştirin',
    retry: 'Doğrulama yüklenemedi.',
    retryLink: 'Sayfayı yenile',
      lama: 'Doğrulama beklenenden uzun sürüyor.',
      lamaSaran: 'İnternet bağlantınızı kontrol edin ve sorun devam ederse sayfayı yenileyin.',
    rayId: 'Ray ID',
    footer: 'Performans ve Güvenlik:',
    privacy: 'Gizlilik',
    ariaBusy: 'Doğrulama sürüyor'
  },
  'uk': {
    title: 'Перевіряємо, що ви людина',
    lead: 'Цей сайт використовує службу безпеки для захисту від шкідливих ботів. Ця сторінка відображається, поки ми перевіряємо, що ви не бот.',
    success: 'Перевірку пройдено. Очікування відповіді від',
    noscript: 'Увімкніть JavaScript і файли cookie, щоб продовжити',
    retry: 'Не вдалося завантажити перевірку.',
    retryLink: 'Перезавантажити сторінку',
      lama: 'Перевірка триває довше, ніж очікувалося.',
      lamaSaran: 'Перевірте підключення до інтернету та оновіть сторінку, якщо проблема не зникне.',
    rayId: 'Ray ID',
    footer: 'Продуктивність і безпека від',
    privacy: 'Конфіденційність',
    ariaBusy: 'Триває перевірка'
  },
  'vi': {
    title: 'Chúng tôi đang xác minh bạn là người',
    lead: 'Trang web này sử dụng dịch vụ bảo mật để bảo vệ chống lại bot độc hại. Trang này được hiển thị trong khi chúng tôi xác minh rằng bạn không phải là bot.',
    success: 'Xác minh thành công. Đang chờ phản hồi từ',
    noscript: 'Bật JavaScript và cookie để tiếp tục',
    retry: 'Không thể tải xác minh.',
    retryLink: 'Tải lại trang',
      lama: 'Quá trình xác minh mất nhiều thời gian hơn dự kiến.',
      lamaSaran: 'Kiểm tra kết nối internet của bạn và tải lại trang nếu sự cố vẫn tiếp diễn.',
    rayId: 'Ray ID',
    footer: 'Hiệu suất và Bảo mật bởi',
    privacy: 'Quyền riêng tư',
    ariaBusy: 'Đang xác minh'
  }
};

/** Bahasa cadangan bila tidak ada yang cocok — sama seperti Cloudflare. */
const FALLBACK = 'en';

/**
 * Tentukan kode bahasa dari preferensi browser.
 *
 * @param {string[]} [prefs] Daftar preferensi; default `navigator.languages`.
 * @returns {string} Kode 2 huruf yang ada di MESSAGES, atau FALLBACK.
 *
 * ── KENAPA BERURUTAN, BUKAN SEKALIAN COCOK ─────────────────────────────────
 *
 * `navigator.languages` adalah daftar berurut. Pengunjung dengan
 * ["en-US","id-ID"] memilih Inggris — itu preferensi pertamanya. Kalau kita
 * hanya mencari "bahasa apa pun yang kita punya", orang itu akan dapat
 * Indonesia dan merasa salah. Jadi: hormati urutannya.
 *
 * ── KENAPA COCOK PERSIS DULU ("id-id") LALU 2 HURUF ("id") ─────────────────
 *
 * Turnstile mendukung kode 4 huruf (id-id) DAN 2 huruf (id). Kita menyimpan
 * terjemahan per kode 2 huruf karena teksnya identik; pencocokan 4 huruf
 * dulu memastikan varian seperti zh-TW tidak salah jatuh ke zh-CN kalau
 * nanti kita pisahkan.
 */
function detectLanguage(prefs) {
  const list = prefs || (typeof navigator !== 'undefined' && navigator.languages) || [];
  if (!list.length) return FALLBACK;

  // Lolos 1: cocokkan kode penuh, tapi hanya kalau kita punya varian itu.
  for (const tag of list) {
    const full = String(tag).toLowerCase();
    if (MESSAGES[full]) return full;
  }

  // Lolos 2: kode 2 huruf, mengikuti urutan preferensi.
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (MESSAGES[base]) return base;
  }

  return FALLBACK;
}

/**
 * Ambil terjemahan untuk kode bahasa, dengan cadangan per-kunci.
 *
 * Cadangan per-kunci (bukan per-objek) penting: kalau sebuah bahasa punya
 * terjemahan yang belum lengkap, kunci yang hilang jatuh ke Inggris —
 * pengunjung tidak pernah melihat `undefined` di layar.
 */
function messagesFor(code) {
  const base = MESSAGES[FALLBACK];
  const picked = MESSAGES[code] || {};
  return Object.assign({}, base, picked);
}

/* Dipakai cf-gate.js sebagai script klasik (bukan module) supaya bekerja di
   semua halaman tanpa mengubah cara pemuatan script di HTML. */
window.CF_GATE_I18N = {
  MESSAGES: MESSAGES,
  FALLBACK: FALLBACK,
  detect: detectLanguage,
  for: messagesFor
};
})();