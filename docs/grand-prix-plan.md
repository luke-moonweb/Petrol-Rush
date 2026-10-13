# Grand Prix – plan implementacji (v2, po krytyce)

Branch: `feature/grand-prix`. Wersja v1 planu była recenzowana przez 4 agentów: designera
wizualnego/UX, projektanta poziomów, testera QA i game designera od grywalności. Sekcja 9 zbiera ich
uwagi i to, co zmieniło się w planie.

## 0. Cel

Nowy tryb **GRAND PRIX**, czyli mistrzostwa z 5 wyścigów na 5 **nowych** torach o innym kształcie niż
owal. Owal (2 łuki R=147 + 2 proste po 1824 px, TRACK_LEN = 4571,6 px, idealne okrążenie 16,1 s)
zostaje w QUICK RACE i w demie na ekranie tytułowym, **bez zmian zachowania**.

## 1. Stan obecny (fakty z kodu)

Geometria owalu jest wpisana na sztywno prawie wszędzie:

- `track.ts`: stałe modułu, analityczne `pointAt`/`project`, `inTurn(x)` liczone po X.
- `physics.ts`: `cornerAssist` liczy promień od środka łuku owalu i zawsze skręca w lewo (:65-73);
  limit 150 mph w każdym zakręcie.
- `ai.ts`: `distToTurn` liczone tylko do `S_TURN1`/`S_TURN2`; pit sterowany po X/Y;
  pasy zjazdu/wyjazdu wpisane jako `-HALF_W+9`, `LANES[0]`, `EXIT_D`.
- `canvas.ts`: grid, linia mety, pit i padok rysowane prostokątami osiowymi.
- Kamera ma tylko `camX`; świat ma wysokość równą `PLAY_H`.
- `TRACK_LEN` używany poza torem: `wrapS`/`deltaS`, paliwo (`physics.ts:170`), `car.ts`,
  `race.ts:320`, `hud.ts:152`.

## 2. Architektura

### 2.1 Interfejs `Track`, przekazywany jawnie

```ts
interface Track {
  id; name; len; sectorLen; worldW; worldH;
  pointAt(s, d); project(x, y, hintS?); headingAt(x, y);
  wrapS(s); deltaS(a, b);
  cornerAt(x, y, s): CornerInfo | null;    // { id, radius, dir: ±1, limitMph, center }
  nextCorner(s): { dist, info } | null;    // dla AI, HUD i ostrzeżeń
  constrain(p): WallNormal | null;
  gridSlot(slot): { s, d };                // z lustrzanym odbiciem pasów (pole position po wewnętrznej T1)
  pit: PitLayout | null;                   // null = tor bez pit lane (patrz decyzja D1)
}
```

- `Race` dostaje `track`. Tor trafia do `stepCar`, `aiInput`, `collideCars`, `updatePit`,
  `progress`/`updateProgress` oraz do HUD.
- Test strukturalny pilnuje, że stałe owalu importuje tylko `OvalTrack`, jego renderer i testy owalu.
- **`OvalTrack`** to obecny kod opakowany 1:1. Zakręt dalej rozpoznawany po pozycji, a `cornerAssist`
  dalej liczy promień od środka łuku.
- **`SegmentTrack`** to nowa, generyczna implementacja.

### 2.2 `SegmentTrack`: wielokąt z promieniami w wierzchołkach

Projektant toru podaje wierzchołki `(x, y, R)` w kolejności jazdy, czyli pracuje we współrzędnych
świata. Kompilator zamienia je na listę prosta/łuk:

- styczna `T = R·tan(Δ/2)`, warunek `T_i + T_{i+1} ≤ długość krawędzi`;
- pętla domyka się z konstrukcji, więc nie potrzeba `closeLoop`;
- łuk o dwóch promieniach (double apex) to dwa bliskie wierzchołki.

`pointAt`/`project` liczone są analitycznie dla każdego segmentu. `project` z `hintS` musi dawać ten sam
wynik co bez hintu; hint tylko zawęża przeszukiwanie (≤3 segmenty).

Walidator działa jako test i jako assert w trybie dev. Każda reguła ma przykładowy tor, który musi
odrzucić:

- `R ≥ R_MIN` dla danej klasy zakrętu (patrz 2.3);
- odstęp osi między nieprzyległymi fragmentami (|Δs| > 450) co najmniej 180 px, a po stronie pitu
  co najmniej 240 px;
- prosta startowa: 668 px pola startowego + 60 px za metą + ≥400 px do T1. Jeśli tor ma pit,
  pit z przejściami musi w całości leżeć na tej prostej (≥ ~1200 px);
- świat ≤ 2600 × 1800 px.

**Ustalenie dla wszystkich torów:** prosta startowa jest pozioma, jazda na niej na wschód, pit i padok
od północy (tak jak na owalu). Grid, linię mety, pit, padok i trybuny można wtedy przenieść z owalu
przez `translate()`. Kierunek całej pętli (z ruchem wskazówek zegara lub przeciwnie) może być różny,
więc pit wypada raz po wewnętrznej, raz po zewnętrznej.

**Ściany:**

- wewnętrzna strona każdego łuku dostaje przejezdny, płaski krawężnik o szerokości 12 px
  (od 100 px przed łukiem do 100 px za nim), ściana jest na `HALF_W + 12`;
- szykana ma krawężnik po obu stronach.

Powód: AI na pasie wewnętrznym ścina zakręt do |d| ≈ 42 (na owalu ratuje je wyspa leżąca 12 px za
asfaltem). Lookahead AI zostaje bez zmian.

### 2.3 Zakręty: klasy z czytelnymi limitami (decyzja D2)

Rekomendacja to **dyskretne klasy**, a nie ciągły limit `150·√(R/147)`. Ciągły limit sprawia, że nawyk
z owalu „hamuj do 150” na R=130 kończy się obrotem bez fazy poślizgu (przekroczenie limitu o 9 mph,
a `SLIDE_SPIN_OVER` = 8). Limity ułamkowe gryzą się też z `Math.round(speed)`.

| Klasa | Limit | Promień osi | Kolor tablicy/kerbu |
|---|---|---|---|
| FLAT | brak (≥180) | ≥ 215 | brak tablicy |
| FAST | 150 | 150–200 | znany limit z owalu |
| MEDIUM | 120 | ~115–125 | |
| HAIRPIN | 90 | ~90–95 | wymaga długiej, poziomej strefy hamowania |

- Projektant toru wybiera klasę, a promień wynika z fizyki. Wykonalność sprawdza warunek
  `limit ≤ min(150·√(R/147), 2.9·(R−36.5)/1.7)`: auto na pasie wewnętrznym musi utrzymać łuk przy
  `MAX_TURN_RATE`.
- Szykana (3 łuki R110 40°/80°/40°, wychylenie 96 px) liczy się jako jeden kompleks z jednym limitem
  i ma flagę `singleFile`: AI nie zmienia w niej pasa.
- `cornerAssist` mnożony przez `dir` zakrętu. Bez tego asysta na zakrętach w prawo pchałaby gracza
  w ścianę.
- **SKID, pasek prędkości i znacznik limitu na prędkościomierzu** pokazują limit *następnego* zakrętu
  w zasięgu hamowania, nie tylko bieżącego. Na prostej to one ostrzegają, i tak jest też dziś
  na owalu.
- AI: `turnMph / 150` to współczynnik (0,94–0,99) mnożony przez limit klasy. Rachunek musi dać na owalu
  wynik bit w bit: `turnMph * (limit / 150)`. Hamowanie liczone jako minimum
  `sqrt(v_lim² + 2·a·dist)` po zakrętach w zasięgu.
- Łuki FLAT są traktowane jak prosta, także przy progu obrotu po kolizji (`physics.ts:358`) i przy
  zmianie pasa (`distToTurn`).

### 2.4 Kamera 2D

- `camX` i `camY` celują w punkt na **osi toru** `pointAt(s + k·v)`, a nie w kurs auta, żeby kamera nie
  kręciła się w czasie spinu. Zmiana wyprzedzenia ma ograniczoną prędkość, a pozycja jest wygładzana.
- Czysta funkcja `clampCamera(world, view)` obsługuje przypadek świata mniejszego niż widok (21:9).
- Świat ma margines tła ≥ ½ kadru.
- Na owalu `camY` = 0, więc zachowanie zostaje identyczne.
- Do przeróbki: `drawImage` z `sx, sy`, olej, auta, światła, cząsteczki, marker gracza, pasek
  prędkości, culling po X i Y.

### 2.5 Render toru generycznego (wzorzec gotowy już w F2)

- Asfalt i ściany jako `Path2D` z `lineTo` i `arc(r ± d)` (dokładnie, bez próbkowania).
- Ściany zachowują dzisiejszy język wizualny według strony toru:
  - strona infieldu: turkus (jak wyspa);
  - strona zewnętrzna: czerwono-kremowe pasy;
  - krawężniki płaskie, w innym wzorze, wewnątrz linii krawędzi.
- Tło zajmuje ok. 75% kadru, dlatego jest robione w F2, a nie na końcu:
  - wzór gruntu przez `createPattern`;
  - pobocze 40–60 px;
  - maszty z lampami;
  - szum przez wzór, a nie przez pętlę `getImageData`.
- Na torze: tablice dohamowania 3-2-1 i szewrony na ścianie przed zakrętem (koszt zerowy, bo są
  w prerenderze).
- Wysokie rekwizyty (budynki, dźwigi) nie mogą stać na południe od asfaltu, bo zasłaniałyby tor.
- Cache płócien: owal dla tytułu plus jeden tor GP. Budowanie odbywa się podczas wyświetlania karty
  toru.
- Motyw toru: paleta tła, wzór gruntu i najwyżej 2 typy rekwizytów. Asfalt i ściany mają wspólny
  kolor na wszystkich torach, dla kontrastu aut.
- Najdłuższe proste są poziome. Sprite'y rysowane pod 45° są skrócone w pionie, a w pionie widać też
  mniej toru do przodu.

### 2.6 HUD

- **Tablica następnego zakrętu**, u góry na środku kadru:
  - piktogram z kątem łuku i limitem, bez kodowania samym kolorem;
  - widoczna od strefy hamowania do wyjścia z zakrętu;
  - szykana jako jeden numer z ikoną „S”;
  - `drawRaceMessage` przesunięty niżej.
- **Minimapa** jako nakładka ok. 110×80 w rogu kadru:
  - kontur prerenderowany;
  - rywale jako neutralne kropki, gracz wyróżniony kształtem i obrysem;
  - wygaszana, gdy auto jest pod nią.
- Info o GP (`R2/5 · HARBOUR`) w nagłówku wieży, a nie w górnym pasku.
- Tekst ≥ 11 px logicznych, liczba na tablicy ≥ 16 px (telefon ma skalę ~0,6).

### 2.7 Pit lane (zależny od decyzji D1)

Jeśli GP v1 ma mieć pit stopy:

- pit wyłącznie na prostej startowej, od północy;
- renderer pitu z owalu przesunięty przez `translate`;
- AI w pitach przepisane na współrzędne pit lane;
- dozwolony obszar to suma korytarzy z histerezą `pitSide`/`wasInPit` (jak na owalu), żeby nie dało
  się „przeskoczyć” separatora;
- `collideCars` dalej pomija pary aut po dwóch stronach separatora;
- zasięg paliwa skalowany do dystansu wyścigu (~0,6 → jeden postój z oknem);
- każde auto ma własny boks: 20 boksów, rozstaw ~50 px;
- naprawić `freeBox`: dziś zwraca zajęty boks i nie szuka do tyłu (`ai.ts:384-392`).

## 3. Tryb Grand Prix (meta)

- Menu tytułowe: `QUICK RACE` · `GRAND PRIX` · CONTROLS · SETTINGS · CREDITS. Znaczek CONTINUE w wierszu
  GRAND PRIX otwiera panel CONTINUE / NEW (szósty wiersz nie mieści się nad paskiem TOP 5).
- Ustawienia GP:
  - liczba aut;
  - długość: SHORT / NORMAL, a liczba okrążeń wynika z **dystansu** (np. NORMAL ≈ 40 tys. px,
    czyli 8/6/6/6/5 okr.);
  - kolor auta;
  - GRID POSITION jak dziś;
  - opcjonalnie poziom trudności AI (D4).
- Ekran przed wyścigiem łączy kartę toru z tabelą mistrzostw:
  - miniatura z numerami zakrętów T1…Tn;
  - długość toru i najwolniejszy zakręt;
  - zmiany pozycji jako strzałka z liczbą.
- Punktacja: 25-18-15-12-10-8-6-4-2-1, kary wliczone.
  - Remis rozstrzygają kolejno: liczba wygranych, lepsze miejsca, na końcu `colorIdx`.
  - Klasyfikacja GP jest kluczowana po `colorIdx`, nie po `car.id`, bo `id` to numer pola startowego.
- Pole startowe: gracz ma wybrane GRID POSITION, a AI ustawia się według klasyfikacji.
  **Bez odwróconego pola** (lider nie mógłby wygrać, bo AI traci do gracza tylko 0,11 s/okr.).
- Koniec wyścigu:
  - po mecie gracza (albo po RETIRE) reszta wyścigu jest deterministycznie dosymulowana w tle,
    z limitem czasu i statusem DNF;
  - AI dostaje punkty za prawdziwe miejsca.
- Restart:
  - dozwolony, ale liczony;
  - **RETIRE** w menu wyścigu (dziś bez paliwa można tylko nacisnąć ESC);
  - RACE SETTINGS ukryte w trakcie GP.
- Zapis `petrolrush.gp`:
  - czyste funkcje `parseGp`/`serializeGp` z wersją formatu i walidacją;
  - seed wyścigu = f(gpSeed, numer wyścigu);
  - parametry AI losowane raz na GP osobnym strumieniem RNG i przekazywane do `Race` jako roster.
- Podium końcowe oparte na `drawResults`. Prosta nagroda: puchar według miejsca, wyróżnienia GRAND SLAM
  (5/5 wygranych) i CLEAN (bez kar). Opcjonalnie gablota pucharów (D4).
- Nowe tory dostępne też w QUICK RACE (wybór toru), żeby dało się trenować (D4).
- Fajerwerki tylko na podium.

## 4. Pięć torów (wstępne kształty od projektanta poziomów)

Wierzchołki `(x, y, R)` w kolejności jazdy. Kształty będą dopasowane do ustaleń z 2.2 (start poziomo
na wschód, pit od północy) i do klas zakrętów z 2.3.

| # | Tor | Kierunek | Kształt i charakter | Długość / okrążenie |
|---|---|---|---|---|
| 1 | **HARBOUR** | CW | Trójkąt: zakręt FLAT, FAST, MEDIUM. Wprowadzenie; pierwszy zakręt nie jest najwolniejszy | ~4800 px / ~17 s |
| 2 | **DESERT KIDNEY** | CCW | Nerka: wklęsły HAIRPIN w prawo w środku pętli w lewo | ~6400 px / ~23 s |
| 3 | **CITY** | CW | Kształt „L”: 5 zakrętów w prawo, 1 wklęsły w lewo, szykana; 5 stref hamowania | ~6300 px / ~24 s |
| 4 | **FOREST** | CCW | Double apex, esy prowadzące na długą prostą, łuki 60° naprzemiennie | ~6600 px / ~24 s |
| 5 | **GRAND FINALE** | CW | Wszystko naraz: główna strefa hamowania 180→120, szykana, nawrót HAIRPIN, esy | ~7650 px / ~30 s |

Figura „8” jest poza zakresem v1.

## 5. Fazy i kryteria akceptacji

| Faza | Zakres | Kryterium |
|---|---|---|
| **F−1** | Test „złoty” owalu (pierwszy commit na branchu, przed refaktorem): 5 scenariuszy z seedem, hash FNV-1a co 30 kroków + czytelny snapshot | Snapshot zapisany |
| F0 | Interfejs `Track`, `OvalTrack`, jawne `track`, test strukturalny importów | Snapshot bit w bit; w testach zmieniają się tylko importy; czas symulacji +10% najwyżej |
| F1 | `SegmentTrack` z wierzchołków, walidator, klasy zakrętów, owal zbudowany z segmentów jako punkt odniesienia | Owal z segmentów = `OvalTrack` (≤1e-9); testy właściwości geometrii dla każdego toru |
| F2 | Kamera 2D, render generyczny, **jeden tor w pełni jako wzorzec** (tło, kerby, tablice), tablica zakrętu, minimapa | Smoke test w przeglądarce |
| F3 | AI: klasy zakrętów, kierunek, szykany, `singleFile` | Headless na każdym torze: mediana okrążenia AI ∈ [1,0; 1,25] × czas idealny; spiny na okrążenie ≤ 2× wynik owalu; żadne auto nie stoi >10 s |
| F4 | Pit lane (jeśli D1 = tak) | Headless z `fuel0` = 0,25: każde auto tankuje i kończy wyścig; scenariusz z zaparkowanymi autami |
| F5 | Tryb GP: menu, karta i tabela, punkty, dosymulowanie, RETIRE, zapis | Testy jednostkowe punktacji, remisów, `parseGp`; pełny sezon headless (5 × 3 okr.) |
| F6 | Pozostałe 4 tory i motywy | Przegląd wizualny i balans |
| F7 | README, workflow CI na `pull_request` (dziś CI działa tylko przy push do main), PR | lint, typecheck i testy zielone |

## 6. Testy

- Wspólny harness `tests/sim/runRace({ track, seed, fuel0 })`, jeden plik na tor (równoległość),
  jawne limity czasu. Wydajność mierzona liczbą segmentów sprawdzanych w `project`, nie w ms.
- Geometria:
  - `project(pointAt(s,d))` także dla |d| do pit lane i 10 px za ścianą;
  - ciągłość `deltaS ∈ (0, 2]` co 1 px;
  - `project` z hintem daje ten sam wynik co bez hintu.
- Ściany i pit: fuzz 10 tys. pozycji przy końcach separatora; auto nigdy nie zostaje w ścianie.
- GP:
  - punkty i remisy;
  - GP z 1 autem;
  - kara zamieniająca P1 i P2;
  - DNF gracza: 0 pkt i kompletna klasyfikacja;
  - uszkodzony, stary i nowszy zapis;
  - wyjątek przy `getItem`;
  - parametry URL ignorowane przy CONTINUE.
- Soak test (`npm run test:soak`, 10 seedów) poza CI.
- Testy ręczne: zgodnie z listą testera (owal bez zmian, pełne GP, odświeżenie na każdym ekranie,
  RETIRE, cofanie przez metę, telefon pionowo i poziomo, 21:9, iOS).

## 7. Ryzyka

- Regresja wyczucia owalu: osłania ją test złoty.
- AI w szykanach i nawrotach: krawężniki, `singleFile`, kalibracja headless.
- Pamięć i czas budowania canvasa na telefonach: rysowanie przez wzór zamiast `getImageData`,
  budowanie w czasie karty toru.
- Zakres: duży. Szacunek bez pitu ok. 3 tys. linii, z pitem ok. 4–5 tys.

## 8. Decyzje użytkownika (podjęte, nadpisują wcześniejsze sekcje)

- **D1 – pit lane na każdym torze, paliwo bez zmian** (`FUEL_RANGE_LAPS` = 12 okrążeń danego toru).
  Pit jest potrzebny w długich wyścigach. Faza F4 zostaje w całości.
- **D2 – limit 150 mph w każdym zakręcie**, jak na owalu; nie ma klas zakrętów.
  - Każdy łuk to zakręt z limitem 150.
  - R_MIN = 120: auto przy 150 mph skręca po promieniu 88 px, a pas wewnętrzny ma R − 28.5;
    przy R = 120 zostaje 3,5 px zapasu.
  - Tablica zakrętu w HUD niepotrzebna: SKID ostrzega na prostej jak dziś.
  - Na torze zostają szewrony na ścianach przed zakrętami.
- **D3 – liczba okrążeń jak dziś (1–100)**, ta sama dla wszystkich wyścigów GP.
- **D4 – z dodatków tylko nowe tory w QUICK RACE** (wybór toru).
  - Bez poziomów trudności, gablot i minimapy.
  - Miniatura toru tylko na karcie przed wyścigiem i przy wyborze toru.

## 9. Krytyka – co zmieniło się względem v1

| Uwaga (kto) | Zmiana |
|---|---|
| W GP przy 3/6 okr. nikt nie zjedzie do pitu, F4 bez rozgrywki (wszyscy 4) | Decyzja D1; skalowany zbiornik albo GP bez pitu |
| Ciągły limit √R to pułapka; 150 vs 141 mph = obrót (grywalność) | Dyskretne klasy FLAT/150/120/90 |
| Wąski zakres 130–180 mph, tory podobne (poziomy) | Klasa HAIRPIN 90 dzięki warunkowi `min(...)` |
| AI ścina zakręt do \|d\|≈42 i trze o ścianę (poziomy) | Przejezdny kerb 12 px po wewnętrznej |
| `cornerAssist` zawsze w lewo; GRID i pasy pitu nie są lustrzane (poziomy, grywalność) | `dir` zakrętu, lustrzane odbicie |
| SKID i pasek na prostej przestałyby ostrzegać (grywalność) | Ostrzeżenia liczone od następnego zakrętu |
| „Testy przejdą bez zmian” – nieprawda; brak wzorca regresji (QA) | Faza F−1 z testem złotym, `cornerAt(x,y)` w owalu |
| `closeLoop` źle uwarunkowany, nie domyka kursu (poziomy) | Wielokąt z promieniami |
| Szykana 2 łuki = 51 px przesunięcia (poziomy) | 3 łuki 40/80/40, `singleFile` |
| Odstęp 2·HALF_W+60 = 40 px między ścianami (designer, poziomy) | ≥180 px, przy picie ≥240 px |
| Tło = 75% kadru, puste (designer) | Tło i wzorzec toru w F2 |
| Grid/meta/pit nie są generyczne (designer) | Prosta startowa pozioma, wschód, pit od północy |
| Kamera z kursu kręci się przy spinie (designer, grywalność) | Cel na osi toru |
| Minimapa nie mieści się w panelu (designer) | Nakładka w kadrze |
| Odwrócone pole = kara za wygraną (grywalność) | Usunięte |
| Brak DNF/RETIRE, wyniki przed metą AI (QA, grywalność) | RETIRE, dosymulowanie |
| Restart przez odświeżenie strony (QA, grywalność) | Restart dozwolony i liczony |
| `seed++`, wspólny RNG, `car.id` ≠ tożsamość (QA) | Seed z GP, osobny strumień RNG, klucz `colorIdx` |
| Boks na zespół wygląda jak błąd, `freeBox` (designer, QA) | Własny boks, poprawka `freeBox` |
| Brak CI dla PR (QA) | Workflow `pull_request` w F7 |
