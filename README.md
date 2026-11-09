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

## Steuerung

| Aktion | Touch | Tastatur |
| --- | --- | --- |
| Steuern | linke Bildschirmhälfte | WASD / Pfeiltasten |
| Feuern | FEUER | Leertaste |
| Rakete | RAKETE | M / Enter |
| Nachbrenner | BOOST | Shift |
| Ziel wechseln | ZIEL | T |
| Autopilot | AUTOPILOT | J |
| Schub | Regler rechts | Q / E |
| Pause | II | Esc |
