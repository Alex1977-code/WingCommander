# Sternenfront – Der Perseus-Krieg

Ein mobiles 3D-Weltraumkampfspiel im Stil klassischer Space-Combat-Sims: Trägerschiff, Flügelmann,
Einsatzbesprechungen und eine Story-Kampagne mit sechs Missionen. Eigenes Universum, eigene Story,
eigene Schiffe – läuft direkt im Browser (Handy, Tablet, Desktop) und lässt sich als PWA installieren.

## Features

- **3D-Grafik mit Three.js**: PBR-Materialien, Nebel-Skybox per Shader, Planeten mit Atmosphäre,
  Bloom, Partikel-Explosionen, Asteroidenfelder – alles prozedural, keine Asset-Downloads
- **Kampagne**: 6 Missionen (Patrouille, Geleitschutz, Trägerverteidigung, Angriff auf Großkampfschiffe),
  Dialoge, Briefings mit Taktikkarte, Nachbesprechung, Ränge und Speicherstand
- **Kampf**: 3 fliegbare Jäger, 4 Feindtypen inkl. Ass-Pilot, Zerstörer und Kommandoschiff mit Geschütztürmen,
  Lenkraketen, Schilde, Nachbrenner, Vorhalteanzeige mit Zielhilfe, Radar, Autopilot
- **Touch-Steuerung**: virtueller Stick, Feuer/Rakete/Boost/Ziel, Schubregler – dazu Tastatur am Desktop
- **Synthetischer Sound** über WebAudio
- **Sci-Fi-Präsentation**: Texte entschlüsseln sich aus Zufallszeichen, Hologramm-Porträts der Figuren,
  Glitch-Titel mit RGB-Versatz, Scanlines, CRT-Einblendungen, Kino-Einblendung zum Missionsstart
- **Gamepads**: Xbox-, PlayStation- und Bluetooth-Controller im Flug und in allen Menüs
- **Koop für 2 Spieler** im geteilten Bildschirm (Gamepad, Handy oder Tastatur + Gamepad)
- **Handy als Controller**: QR-Code scannen, das Handy zeigt Stick und Tasten (WebRTC über PeerJS)
- **TV-Modus** (`?tv=1`): Code und QR-Code direkt im Hauptmenü; Chromecast über die Presentation API

## Entwicklung

```bash
npm install
npm run dev      # Entwicklungsserver (im WLAN auch vom Handy erreichbar)
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

Die Handy-Verbindung nutzt den öffentlichen PeerJS-Vermittlungsdienst nur für den Verbindungsaufbau; danach
laufen die Daten direkt zwischen den Geräten. Für einen eigenen Dienst: `npm run peer` starten und das Spiel mit
`?peer=host:9000` öffnen.

`npm run build:artifact` erzeugt zusätzlich eine einzelne, eigenständige HTML-Datei ohne die WebRTC-Funktionen.

## Steuerung

| Aktion | Touch | Gamepad | Tastatur |
| --- | --- | --- | --- |
| Steuern | linke Bildschirmhälfte | linker Stick | WASD / Pfeiltasten |
| Feuern | FEUER | RT / A | Leertaste |
| Rakete | RAKETE | X / RB | M / Enter |
| Nachbrenner | BOOST | LT / LB | Shift |
| Ziel wechseln | ZIEL | Y | T |
| Autopilot | AUTOPILOT | Select | J |
| Schub | Regler rechts | rechter Stick / Steuerkreuz | Q / E |
| Pause | II | Start | Esc |
