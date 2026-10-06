# Online Pong

Ganz einfaches Pong für zwei Spieler übers Internet. Der Node.js-Server berechnet
das Spiel, beide Browser zeigen es nur an (verbunden per WebSocket).

## Starten

```bash
npm install
npm start
```

Dann im Browser <http://localhost:3000> öffnen – in zwei Tabs oder auf zwei Geräten.

## Spielen

- **Zufälliger Gegner:** Seite öffnen, man wird automatisch mit dem nächsten Spieler gepaart.
- **Mit einem Freund:** „Privates Spiel mit Freund" klicken und den angezeigten Link schicken.
- **Steuerung:** `W`/`S` oder `↑`/`↓`, am Handy einfach den Finger aufs Spielfeld legen.
- Wer zuerst 7 Punkte hat, gewinnt. Danach startet automatisch eine neue Runde.

## Online stellen

Der Server liest den Port aus der Umgebungsvariable `PORT`, läuft also direkt auf
Hostern wie Render, Railway oder Fly.io (Startbefehl `npm start`). Alternativ per Docker:

```bash
docker build -t pong .
docker run -p 3000:3000 pong
```
