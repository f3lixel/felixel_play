# PRD: Nintendo Switch-Style UI Redesign

## 1. Einleitung / Übersicht

Das aktuelle UI von **felixel play** soll von einem klassischen Bibliotheks-Layout (Header + Hero + Spielreihen) zu einem **Nintendo Switch Home Screen-inspirierten Design** umgebaut werden. Ziel ist eine immersive, vollbild-zentrierte Oberfläche, bei der das aktuell fokussierte Spiel visuell im Mittelpunkt steht – sein Cover-Artwork füllt den gesamten Hintergrund. Die Bedienung soll sowohl mit Maus als auch mit Gamepad flüssig funktionieren.

---

## 2. Ziele

- Das UI soll dem Zielbild (Nintendo Switch Home Screen) visuell sehr nahe kommen
- Die Spielbibliothek bleibt vollständig erhalten und navigierbar
- Der Hintergrund wechselt dynamisch zum Artwork des aktuell fokussierten Spiels
- Die Oberfläche wirkt clean, modern und immersiv – kein klassischer App-Header mehr
- Echtzeit-Uhrzeit und WLAN-Status werden in der oberen rechten Ecke angezeigt
- Das felixel play Branding bleibt oben links als Logo/Icon erhalten

---

## 3. User Stories

- **Als Nutzer** möchte ich das Artwork meines aktuell ausgewählten Spiels als Hintergrundbild sehen, damit ich sofort in die Stimmung des Spiels eintauche.
- **Als Nutzer** möchte ich alle meine Spiele in einer einzigen horizontalen Reihe scrollen können, damit die Navigation einfach und schnell ist.
- **Als Nutzer** möchte ich das aktuell fokussierte Spiel durch einen deutlichen visuellen Rahmen (blauer Glow) erkennen, damit ich sofort weiß, was ich starten würde.
- **Als Nutzer** möchte ich den Namen des aktuell ausgewählten Spiels unterhalb der Kartenreihe sehen.
- **Als Nutzer** möchte ich die aktuelle Uhrzeit und meinen WLAN-Status sehen, damit ich Kontext über mein System habe.

---

## 4. Funktionale Anforderungen

### 4.1 Hintergrund (Background Layer)
1. Der Hintergrund muss das **Cover-Artwork des aktuell fokussierten Spiels** als Vollbild anzeigen.
2. Das Hintergrundbild muss beim Wechsel des Fokus **sanft überblenden** (Cross-Fade, ca. 0.4s).
3. Über dem Hintergrundbild liegt ein **leichter dunkler Gradient-Overlay** (unten stärker, oben leichter), um die Lesbarkeit der UI-Elemente zu gewährleisten.
4. Das aktuelle Hero-Section-Konzept (separater Hero-Bereich) wird **entfernt**.

### 4.2 Top-Bar (Obere Leiste)
5. Die bestehende Glassmorphism-Navigationsleiste (mit Logo, Filtern, Suche) wird **komplett entfernt**.
6. Eine neue, transparente Top-Bar wird implementiert mit:
   - **Oben links**: felixel play Logo/Icon (als kompaktes Branding-Element, kein Text-Header)
   - **Oben Mitte**: System-Icons in einer horizontalen Gruppe – Controller-Icon, Media-Icon, Settings-Icon (als anklickbare Kreisbuttons mit leichtem Glass-Hintergrund, ähnlich dem Zielbild; **kein Power-Icon**)
   - **Oben rechts**: Echtzeit-Uhrzeit (HH:MM, aktualisiert jede Minute) + WLAN-Status-Icon (verbunden/nicht verbunden)
7. Die Settings-Funktion muss über den Settings-Icon in der Mitte weiterhin erreichbar sein.
8. Filter-Buttons (Alle, Switch, Wii U, Wii, Zuletzt) und die Suchleiste werden **entfernt**.

### 4.3 Spielkarten-Reihe (Game Row)
9. Alle Spiele werden in **einer einzigen horizontalen Reihe** angezeigt (keine mehreren Rows mehr).
10. Die Reihe ist **horizontal scrollbar** (mit Maus/Gamepad).
11. Die Reihe ist **vertikal zentriert** auf dem Bildschirm (leicht unterhalb der Mitte, ähnlich Switch-Layout – ca. 55–65% Bildschirmhöhe).
12. Jede Spielkarte zeigt das **Cover-Artwork** des Spiels.
13. Das **aktuell fokussierte Spiel** muss:
    - Merklich **größer** dargestellt werden als die anderen Karten (ca. 1.2× Skalierung)
    - Einen **blauen Leuchtrahmen / Glow-Effekt** bekommen (wie im Zielbild: helles Blau, `box-shadow` + `border`)
14. Nicht-fokussierte Karten sind etwas kleiner und haben keinen speziellen Rahmen.
15. Karten links und rechts vom Fokus werden **teilweise abgeschnitten** sichtbar (Hinweis auf Scrollbarkeit).
16. Jedes Spiel bleibt eine **einzelne Karte** (keine Gruppierung von Serien).
17. Spiele **ohne Cover-Artwork** zeigen einen **Fallback-Placeholder**: grauer Hintergrund mit dem Spielnamen als zentriertem Text.
18. Die Spielreihe ist nach **zuletzt gespielt** sortiert (zuletzt gespieltes Spiel ganz links). Nie gespielte Spiele kommen ans Ende, alphabetisch sortiert.

### 4.4 Spieltitel-Anzeige
17. Unterhalb der Kartenreihe wird der **Titel des fokussierten Spiels** angezeigt.
18. Vor dem Titel steht ein kleines **Icon** (z.B. Spielkarten-Symbol oder Plattform-Badge), wie im Zielbild zu sehen.
19. Der Titel wird **abgeschnitten mit `…`**, wenn er zu lang ist (ähnlich dem Zielbild: „The Legend of Zelda Te..").

### 4.5 Controller-Setup-Overlay
19. Beim Klick auf den **Controller-Icon** in der Top-Bar öffnet sich ein Modal-Overlay als Vorschau des Controller-Setups.
20. Das Overlay zeigt eine **Platzhalter-UI** (z.B. schematische Darstellung eines Controllers mit Beschriftungen) – vorerst keine echte Konfigurationsfunktionalität.
21. Das Overlay ist **schließbar** per Klick auf ein X-Icon oder per Escape/B-Taste (Gamepad).

### 4.6 Interaktion & Navigation
22. Fokus-Wechsel durch **Mausklick** auf eine Karte oder durch **Gamepad D-Pad / Linker Stick** links/rechts.
23. Ein **Drücken von A (Gamepad) oder Doppelklick (Maus)** auf die fokussierte Karte startet das Spiel.
24. Der bestehende Launch-Overlay und Pause-Overlay bleiben erhalten und müssen **nicht geändert werden**.

---

## 5. Non-Goals (Nicht im Scope)

- Keine Karten-Gruppierung nach Serien (jedes Spiel = eine Karte)
- Keine Suchfunktion im neuen Design
- Keine Filter-Buttons (Alle, Switch, Wii U, etc.)
- Keine Batterieanzeige (nur Uhrzeit + WLAN)
- Keine konfigurierbaren Nutzerprofilbilder
- Keine Änderungen am Launch-Overlay oder Pause-Overlay
- Keine Änderungen an der Emulator-Logik (main.js, GamepadManager.js, etc.)
- Controller-Setup-Overlay hat vorerst keine echte Funktionalität (nur UI-Vorschau)

---

## 6. Design-Vorgaben

### Referenzbild
Das Zielbild (Nintendo Switch Home Screen) ist unter folgendem Pfad gespeichert:
`C:\Users\f3lix\.cursor\projects\...\assets\Design_ohne_Titel__1_-fb50d507-...png`

### Farben & Stil
- **Hintergrund**: Vollbild-Artwork, leicht dunkler Gradient-Overlay
- **Top-Bar**: Vollständig transparent, keine Hintergrundfarbe, kein Glassmorphism
- **System-Icons (Mitte)**: Runde Buttons mit leicht grauem/weißem transparenten Hintergrund (`rgba(255,255,255,0.15)`), Outline-Icons in Weiß/Grau
- **Fokus-Rahmen**: Blauer Leuchtrahmen (`border: 3px solid #5bbfff`, `box-shadow: 0 0 20px #5bbfff`)
- **Spieltitel**: Weiß, kleine Schriftgröße (~14–16px), mit leichtem Schatten für Lesbarkeit
- **Uhrzeit/WLAN**: Weiß, kleine Schriftgröße (~13–14px), oben rechts

### Typografie
- Schriftart bleibt `Inter` (wie bisher)
- Logo-Bereich: `felixel play` Branding kompakt und klein

### Animationen
- Hintergrund-Crossfade: 0.4s ease-in-out
- Karten-Fokus-Skalierung: 0.2s ease
- Karten-Glow: fade-in 0.2s

---

## 7. Technische Hinweise

- Das Projekt ist eine **Electron-App** (`main.js` + `renderer.js` + `styles.css` + `index.html`)
- Der aktuelle `renderer.js` baut die Spielreihen dynamisch aus `games.json` – die Logik muss auf eine einzige Row reduziert werden
- Der aktuelle `hero`-HTML-Block (`<section class="hero">`) kann entfernt oder auf reine Hintergrundfunktion reduziert werden
- Für Echtzeit-Uhrzeit: `setInterval` mit `new Date()` alle 60 Sekunden
- Für WLAN-Status: `navigator.onLine` + Event-Listener `online`/`offline`
- Die `rows-container` Logik in `renderer.js` muss stark vereinfacht werden (nur noch eine Row, kein Row-Label)
- CSS-Änderungen hauptsächlich in `styles.css`; HTML-Änderungen in `index.html`

---

## 8. Erfolgskriterien

- Das UI sieht dem Zielbild (Nintendo Switch Home Screen) visuell erkennbar ähnlich aus
- Das Hintergrundbild wechselt flüssig beim Navigieren durch die Spiele
- Alle Spiele sind in der horizontalen Reihe erreichbar und startbar
- Uhrzeit und WLAN-Status werden korrekt angezeigt und aktualisiert
- Gamepad-Navigation funktioniert weiterhin fehlerfrei
- Keine JavaScript-Fehler in der Electron-Konsole

---

## 9. Entscheidungen (ehemals offene Fragen)

- **Power-Button**: Wird **nicht implementiert** – der Icon entfällt komplett aus der Top-Bar.
- **Controller-Button**: Öffnet ein **Controller-Setup-Overlay** (nur Vorschau/Mockup, noch keine echte Funktionalität – wird später ausgebaut).
- **Spiele ohne Cover-Artwork**: Es wird ein **Fallback-Placeholder** angezeigt (z.B. ein graues Rechteck mit dem Spielnamen als Text in der Mitte).
- **Sortierung der Spielreihe**: Spiele werden nach **zuletzt gespielt** sortiert (zuletzt gespieltes Spiel ganz links). Spiele, die noch nie gespielt wurden, kommen ans Ende, alphabetisch sortiert.
