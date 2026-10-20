# PD Pong

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

## Online stellen (ohne Installation, nur im Browser)

Am einfachsten bei [Render](https://render.com). Die Datei `render.yaml` enthält schon alle Einstellungen.

1. Auf render.com mit dem GitHub-Konto anmelden.
2. **New → Blueprint** wählen und dieses Repository auswählen. Render ggf. Zugriff darauf erlauben.
3. **Apply** klicken. Nach ein paar Minuten zeigt Render die Adresse an, z. B. `https://pd-pong.onrender.com`.
4. Diese Adresse an die Kollegen schicken. Ein Konto braucht zum Spielen niemand.

Im kostenlosen Tarif schläft der Server nach ca. 15 Minuten ohne Besucher ein. Der erste Aufruf danach
dauert dann bis zu einer Minute, danach läuft es normal.

Der Server liest den Port aus der Umgebungsvariable `PORT`, läuft also auch bei anderen Hostern wie
Railway oder Fly.io (Startbefehl `npm start`). Alternativ per Docker:

```bash
docker build -t pong .
docker run -p 3000:3000 pong
```
