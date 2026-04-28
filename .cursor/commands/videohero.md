# videohero

Du hilfst in diesem Electron/JavaScript-Projekt dabei, einem Spiel ein Hero-Preview-Video zuzuweisen.

Der Nutzer ruft dich typischerweise so auf:

`/videohero <Game-Titel oder Game-ID> <Pfad zum Video-Clip>`

Beispiel:

`/videohero Super Mario Odyssey assets/videos/clips/odyssey_loop.webm`

`/videohero 7 assets/videos/clips/SM Bros Wonder.webm`

## Aufgabe

1. Lies `games.json`.
2. Finde das Spiel anhand von `id`, `title` oder `romPath`.
3. Setze oder aktualisiere beim passenden Spiel das Feld:

   `"heroVideo": "<relativer/video/pfad.webm>"`

4. Nutze immer relative Projektpfade mit `/`, z. B.:

   `assets/videos/clips/odyssey_loop.webm`

5. Erhalte alle bestehenden Felder des Spiels:
   `id`, `title`, `platform`, `romPath`, `coverArt`, `heroArt`, `backgroundMusic`.

6. Ändere keine anderen Spiele.

7. Nutze die bestehende Hero-Video-Preview-Logik. Erstelle keine neue Video-Logik, wenn `index.html`, `renderer.js`, `styles.css` und `main.js` bereits `heroVideo` unterstützen.

8. Prüfe nach der Änderung:
   - `games.json` ist gültiges JSON.
   - Der angegebene Video-Pfad existiert.
   - Das Video liegt idealerweise unter `assets/videos/clips/`.

## Wenn Angaben fehlen

Wenn kein Spiel oder kein Video eindeutig angegeben wurde, frage nach:

- Welches Spiel aus `games.json`?
- Welcher Clip aus `assets/videos/clips/`?

## Wichtig

Arbeite minimal. Ziel ist nur, das Feld `heroVideo` beim richtigen Spiel zu setzen.