# Sternenfront – Der Perseus-Krieg

Ein mobiles 3D-Weltraumkampfspiel im Stil klassischer Space-Combat-Sims: Trägerschiff, Flügelmann,
Einsatzbesprechungen, Zwischensequenzen und eine Story-Kampagne mit 21 Missionen. Eigenes Universum, eigene Story,
eigene Schiffe – läuft direkt im Browser (Handy, Tablet, Desktop) und lässt sich als App installieren
(„Zum Startbildschirm hinzufügen“); einmal geladen, funktioniert es auch offline.

## Features

- **3D-Grafik mit Three.js**: PBR-Materialien, Nebel-Skybox per Shader, Planeten mit Atmosphäre,
  Bloom, Partikel-Explosionen, Asteroidenfelder – alles prozedural, keine Asset-Downloads
- **Kampagne in 3 Akten**: 21 Missionen mit eigener Story (Mentor, Verräter, Gefangennahme, Rettung, Finale)
  - 11 Zwischensequenzen in der 3D-Engine mit Kamerafahrten, Untertiteln und Titelkarten
  - Verzweigungen: Manche Niederlagen führen die Geschichte anders weiter statt zum Neustart
  - Bordszenen mit Entscheidungen, die Sympathie, Flügelmann-Können und den Verlauf beeinflussen
  - Zwei Enden („Morgenröte“ und „Asche und Sterne“)
  - Missionstypen: Patrouille, Geleitschutz, Konvoi-Eskorte, Rettung, Aufklärung, Bergung, Abfangen, Durchhalten,
    Flucht, Befreiung, Minenfelder, Angriff auf Zerstörer, Stationen und das Kommandoschiff
- **Kampf**: 3 fliegbare Jäger, 4 Feindtypen inkl. Ass-Pilot, Zerstörer und Kommandoschiff mit Geschütztürmen,
  Pulslaser und Ionenlanze (gelenkter Teilchenstrahl), Plasmasucher und Fusionsladungen der Aszendenz, Schilde, Nachbrenner, Vorhalteanzeige mit Zielhilfe, Radar, Autopilot
- **Touch-Steuerung**: virtueller Stick, Feuer/Lanze/Boost/Ziel, Schubregler – dazu Tastatur am Desktop
- **Effekte**: Explosionen mit Lichtblitz, Feuerball, Rauch und Wrackteilen; Schutzschild-Blasen, Triebwerksspuren,
  Ionenspuren, brennende Großkampfschiffe, Linsenreflexe der Sonne
- **Musik und Sound**: eigener Synth-Score in d-Moll mit Hauptthema, der sich anpasst (Menü, Besprechung, Reise,
  Kampf, Spannung, Trauer, Sieg); geschichtete Soundeffekte mit Hall – alles live per WebAudio erzeugt
- **Sci-Fi-Präsentation**: Texte entschlüsseln sich aus Zufallszeichen, Hologramm-Porträts der Figuren,
  Glitch-Titel mit RGB-Versatz, Scanlines, CRT-Einblendungen, Kino-Einblendung zum Missionsstart
- **Gamepads**: Xbox-, PlayStation- und Bluetooth-Controller im Flug und in allen Menüs
- **Koop für 2 Spieler** im geteilten Bildschirm (Gamepad, Handy oder Tastatur + Gamepad)
- **Handy als Controller**: QR-Code scannen, das Handy zeigt Stick und Tasten (WebRTC über PeerJS)
- **TV-Modus** (`?tv=1`): Code und QR-Code direkt im Hauptmenü; Chromecast über die Presentation API

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver (nur dieser Rechner)
npm run dev:lan  # Entwicklungsserver, im WLAN auch vom Handy erreichbar
npm run build    # Produktions-Build nach dist/
npm run preview  # Build lokal testen
```

`dist/` ist eine rein statische Seite und kann überall gehostet werden. Der Workflow
`.github/workflows/pages.yml` veröffentlicht den Build bei einem Push auf `main` auf GitHub Pages
(dazu in den Repository-Einstellungen unter *Pages* als Quelle „GitHub Actions“ wählen).

## Mehrspieler & TV

| Variante | So geht's |
| --- | --- |
| TV-Browser, Konsole oder PC am TV | Spiel mit `?tv=1` öffnen, Handys scannen den QR-Code und werden zu Controllern |
| Chromecast | In Chrome auf Android: *Mehrspieler & TV → Auf TV streamen*. Das Handy wird zum Controller |
| Bildschirm spiegeln | AirPlay oder Smart View, danach mit Bluetooth-Gamepad spielen |
| Koop | *Mehrspieler & TV → Koop an*. Der zuletzt verbundene Controller fliegt Spieler 2 |

Die Handy-Verbindung nutzt den öffentlichen PeerJS-Vermittlungsdienst (`0.peerjs.com`) für den Verbindungsaufbau.
Danach laufen die Steuerdaten per WebRTC meist direkt zwischen den Geräten; je nach Netzwerk können sie auch über
STUN/TURN-Server von Google bzw. PeerJS vermittelt werden. Schriften und alle anderen Dateien werden mit dem Spiel
ausgeliefert; ohne Handy-Controller nimmt das Spiel keinen Kontakt zu fremden Servern auf.
Für einen eigenen Vermittlungsdienst: `npm run peer` starten und das Spiel mit `?peer=host:9000` öffnen. Das
funktioniert nur, wenn das Spiel selbst per `http` läuft (z. B. `npm run dev:lan`); für die https-Version auf
GitHub Pages braucht der eigene Dienst ein TLS-Zertifikat.

`npm run build:artifact` erzeugt zusätzlich eine einzelne, eigenständige HTML-Datei ohne die WebRTC-Funktionen.

## Steuerung

| Aktion | Touch | Gamepad | Tastatur |
| --- | --- | --- | --- |
| Steuern | linke Bildschirmhälfte | linker Stick | WASD / Pfeiltasten |
| Feuern | FEUER | RT / A | Leertaste |
| Ionenlanze | LANZE | X / RB | M / Enter |
| Nachbrenner | BOOST | LT / LB | Shift |
| Ziel wechseln | ZIEL | Y | T |
| Autopilot | AUTOPILOT | Select | J |
| Schub | Regler rechts | rechter Stick / Steuerkreuz | Q / E |
| Pause | II | Start | Esc |
