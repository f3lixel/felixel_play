## Relevant Files

- `index.html` - HTML-Struktur der App – alter Header wird entfernt, neue Top-Bar und Kartenreihe werden eingefügt
- `styles.css` - Alle CSS-Änderungen: neues Layout, Hintergrund-Layer, Top-Bar, Kartenreihe, Fokus-Effekte, Overlays
- `renderer.js` - Spiellogik, Kartenreihe aufbauen, Fokus-Management, Hintergrund-Wechsel, Uhrzeit/WLAN, Sortierung

### Notes

- Es gibt keine Unit-Tests in diesem Projekt – manuelle Tests in der laufenden Electron-App sind ausreichend
- App starten mit `npm start` (oder dem projekteigenen Startbefehl)
- Nach jeder größeren Änderung die App neu starten und visuell prüfen

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`. This helps track progress and ensures you don't skip any steps.

Example:
- `- [ ] 1.1 Read file` → `- [x] 1.1 Read file` (after completing)

Update the file after completing each sub-task, not just after completing an entire parent task.

## Tasks

- [x] 0.0 Feature-Branch erstellen
  - [x] 0.1 Neuen Branch erstellen und auschecken: `git checkout -b feature/switch-ui-redesign`

- [x] 1.0 Alten Header & Hero entfernen, neue Top-Bar in HTML/CSS aufbauen
  - [x] 1.1 In `index.html`: Den gesamten `<header class="app-header">` Block entfernen
  - [x] 1.2 In `index.html`: Die `<section class="hero">` entfernen (wird durch Fullscreen-Hintergrund in Task 2 ersetzt)
  - [x] 1.3 In `index.html`: Neue `<div class="switch-topbar">` einfügen mit drei Bereichen: `.topbar-left` (Logo), `.topbar-center` (Icons), `.topbar-right` (Status)
  - [x] 1.4 In `index.html`: Im `.topbar-left` das felixel play Logo als kleines kompaktes Element einfügen (Text oder SVG)
  - [x] 1.5 In `index.html`: Im `.topbar-center` drei Icon-Buttons einfügen: Controller (`#btnController`), Media (`#btnMedia`), Settings (`#btnSettings`) – als runde `<button>`-Elemente mit SVG-Icons
  - [x] 1.6 In `index.html`: Im `.topbar-right` Platzhalter für Uhrzeit (`<span id="clockDisplay">`) und WLAN-Icon (`<span id="wifiIcon">`) einfügen
  - [x] 1.7 In `styles.css`: Alle alten Header-CSS-Klassen entfernen
  - [x] 1.8 In `styles.css`: Neue `.switch-topbar` CSS schreiben
  - [x] 1.9 In `styles.css`: `.topbar-center` Icon-Buttons stylen
  - [x] 1.10 In `styles.css`: `.topbar-left` Logo stylen
  - [x] 1.11 In `renderer.js`: `setupNavbarScroll()` und `setupHeaderControls()` entfernt
  - [x] 1.12 In `renderer.js`: Event-Listener für neuen `#btnSettings` verdrahtet

- [x] 2.0 Vollbild-Hintergrund mit Cross-Fade implementieren
  - [x] 2.1 In `index.html`: `#bgLayer1` und `#bgLayer2` eingefügt
  - [x] 2.2 In `styles.css`: `.bg-layer` mit Cross-Fade-Transition gestylt
  - [x] 2.3 In `styles.css`: `.bg-overlay` mit Gradient-Overlay eingefügt
  - [x] 2.4 In `styles.css`: `body` auf `overflow: hidden` gesetzt
  - [x] 2.5 In `renderer.js`: `setFocusedGame()` mit neuen bgLayer1/bgLayer2 implementiert
  - [x] 2.6 Cross-Fade-Toggle-Mechanismus beibehalten
  - [x] 2.7 `heroToggle` → `bgToggle` umbenannt
  - [x] 2.8 Alle alten Hero-Referenzen entfernt

- [x] 3.0 Einzelne horizontale Spielkarten-Reihe aufbauen (inkl. Sortierung & Fallback)
  - [x] 3.1 `rowsContainer` → `gameShelf` in `index.html` ersetzt
  - [x] 3.2 `renderRows()` → `renderShelf()` in `renderer.js` ersetzt
  - [x] 3.3 Sortierfunktion `getSortedGames()` nach zuletzt gespielt implementiert
  - [x] 3.4 Karten als `.shelf-card` gerendert
  - [x] 3.5 Fallback-Placeholder für Spiele ohne Cover implementiert
  - [x] 3.6 `.game-shelf` mit horizontalem Layout gestylt
  - [x] 3.7 `.shelf-card` mit fester Größe 155×220px gestylt
  - [x] 3.8 `.shelf-card-img` mit `object-fit: cover` gestylt
  - [x] 3.9 `.shelf-card-placeholder` gestylt

- [x] 4.0 Fokus-System & Spieltitel-Anzeige implementieren
  - [x] 4.1 `setFocusedGameByIndex()` angepasst
  - [x] 4.2 Click-Event: unfokussierte Karte → Fokus, fokussierte Karte → Launch
  - [x] 4.3 `pointerenter`-Event für sofortigen Fokus bei Hover
  - [x] 4.4 Gamepad Links/Rechts navigiert in der Reihe
  - [x] 4.5 `scrollIntoView` mit `inline: center` auf fokussierte Karte
  - [x] 4.6 `.shelf-card.is-focused` mit blauem Glow gestylt
  - [x] 4.7 `.game-title-bar` mit `#gameTitleText` in `index.html` eingefügt
  - [x] 4.8 `.game-title-bar` gestylt
  - [x] 4.9 Titel-Update bei Fokus-Wechsel implementiert

- [x] 5.0 Controller-Setup-Overlay (Vorschau) erstellen
  - [x] 5.1 `#controllerOverlay` in `index.html` eingefügt
  - [x] 5.2 Controller-SVG-Grafik und Placeholder-Text eingefügt
  - [x] 5.3 `.controller-overlay` gestylt
  - [x] 5.4 Close-Button und Panel gestylt
  - [x] 5.5 `#btnController` Click → Overlay öffnen
  - [x] 5.6 Close via X-Button, Escape-Taste und Gamepad-B implementiert

- [x] 6.0 Uhrzeit & WLAN-Status in der Top-Bar implementieren
  - [x] 6.1 `updateClock()` mit HH:MM Formatierung implementiert
  - [x] 6.2 `startClock()` mit `setInterval(60000)` implementiert
  - [x] 6.3 `updateWifi()` mit `navigator.onLine` implementiert
  - [x] 6.4 `online`/`offline` Event-Listener hinzugefügt
  - [x] 6.5 `#clockDisplay` und `#wifiIcon` gestylt
  - [x] 6.6 App gestartet – keine Fehler in der Konsole
