//! Shared types for all modules: game data (ships, campaign), states, components, messages, settings.
//! Every module may read these; only the owning module writes the resources marked "owner: ...".

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// ---------- gameplay constants (same values as the web version, src/game.js) ----------
pub const BOLT_SPEED: f32 = 950.0;
pub const BOLT_LIFE: f32 = 1.15;
/// neutron cannon ("lance"): range, charge time, beam life, damage vs fighters / capitals
pub const LANCE_RANGE: f32 = 2600.0;
pub const LANCE_CHARGE: f32 = 0.32;
pub const LANCE_DMG: f32 = 75.0;
pub const LANCE_CAP_DMG: f32 = 180.0;
/// seeker lock: target inside this cone (degrees) within LANCE_RANGE for LOCK_TIME seconds
pub const LOCK_CONE_DEG: f32 = 22.0;
pub const LOCK_TIME: f32 = 1.4;
/// impulse drive (boost held on a clear stretch between nav points)
pub const IMPULSE_SPEED: f32 = 2400.0;
pub const IMPULSE_SPOOL: f32 = 0.9;
/// nav point counts as reached within this distance
pub const NAV_ARRIVE: f32 = 2500.0;

// ---------- data (assets/data/*.json, exported from the web game by tools/export-data.mjs) ----------

/// One ship type, see `SHIPS` in src/ships.js. Unknown fields are ignored, missing ones default.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct ShipDef {
    pub name: String,
    pub team: u8,
    pub hp: f32,
    pub shield: f32,
    /// cruise speed (m/s)
    pub speed: f32,
    /// boost speed (player ships only)
    pub boost: Option<f32>,
    /// turn rate (rad/s)
    pub turn: f32,
    pub dmg: f32,
    /// seconds between shots
    pub rof: f32,
    pub missiles: u32,
    pub radius: f32,
    pub capital: bool,
    pub invulnerable: bool,
    pub ghost: bool,
    pub wreck: bool,
    pub bomber: bool,
    pub ace: bool,
    pub skill: f32,
    pub score: u32,
    /// gun muzzles in ship space (+Z forward)
    pub guns: Vec<[f32; 3]>,
    /// capital ship turret positions in ship space
    pub turrets: Vec<[f32; 3]>,
    /// capital ship hull half extents (x, y, z)
    #[serde(rename = "box")]
    pub hull_box: Option<[f32; 3]>,
    /// station ring: [radius, tube radius]
    pub torus: Option<[f32; 2]>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Character {
    pub name: String,
    pub short: String,
    pub color: String,
}

/// One line of dialogue: `who` is a key of `Campaign::chars`, `{cs}` in the text is the player's callsign.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Line {
    pub who: String,
    pub text: String,
}

/// A nav point. The common fields are typed; everything else (waves, convoy, mines, pickups, ...) stays JSON
/// and is interpreted by mission.rs, so the export can grow without breaking the parser.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Nav {
    pub name: String,
    pub pos: [f32; 3],
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub objective: Option<String>,
    #[serde(rename = "onArrive")]
    pub on_arrive: Vec<Line>,
    #[serde(rename = "onClear")]
    pub on_clear: Vec<Line>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Mission {
    pub id: String,
    pub act: String,
    pub title: String,
    pub sector: String,
    /// player ship type
    pub ship: String,
    pub wingman: Option<String>,
    pub briefing: Vec<Line>,
    pub objectives: Vec<String>,
    pub navs: Vec<Nav>,
    pub next: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Campaign {
    pub chars: HashMap<String, Character>,
    pub acts: HashMap<String, String>,
    pub missions: Vec<Mission>,
}

/// All static game data. Loaded once at startup (owner: main.rs).
#[derive(Resource, Clone)]
pub struct GameData {
    pub ships: Arc<HashMap<String, ShipDef>>,
    pub campaign: Arc<Campaign>,
}

impl GameData {
    pub fn load() -> Self {
        let dir = data_dir();
        let ships: HashMap<String, ShipDef> =
            serde_json::from_str(&std::fs::read_to_string(dir.join("ships.json")).expect("assets/data/ships.json fehlt")).expect("ships.json");
        let campaign: Campaign = serde_json::from_str(&std::fs::read_to_string(dir.join("campaign.json")).expect("assets/data/campaign.json fehlt"))
            .expect("campaign.json");
        Self { ships: Arc::new(ships), campaign: Arc::new(campaign) }
    }
    pub fn ship(&self, kind: &str) -> &ShipDef {
        self.ships.get(kind).unwrap_or_else(|| self.ships.get("dorn").expect("ship table"))
    }
    pub fn mission(&self, idx: usize) -> &Mission {
        &self.campaign.missions[idx.min(self.campaign.missions.len() - 1)]
    }
    /// speaker name for a dialogue line
    pub fn speaker(&self, who: &str) -> String {
        self.campaign.chars.get(who).map(|c| c.name.clone()).unwrap_or_else(|| who.to_string())
    }
}

/// assets/data next to the executable (release zip) or in the crate (cargo run)
pub fn data_dir() -> std::path::PathBuf {
    let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("assets/data")));
    match exe {
        Some(p) if p.join("ships.json").exists() => p,
        _ => std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets/data"),
    }
}

// ---------- states ----------

#[derive(States, Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum AppState {
    /// title screen, mission select, settings (owner: menu.rs)
    #[default]
    Menu,
    /// mission briefing text (owner: menu.rs)
    Briefing,
    /// in a mission (flight, ai, weapons, mission, hud, fx)
    Flight,
    /// result screen after a mission (owner: menu.rs)
    Debrief,
}

/// Entities that live only for one mission carry this; mission.rs despawns them all on exit from Flight.
#[derive(Component, Default)]
pub struct InMission;

// ---------- ships ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Team {
    Union,
    Aszendenz,
    Neutral,
}

impl Team {
    pub fn from_def(t: u8) -> Self {
        match t {
            0 => Team::Union,
            1 => Team::Aszendenz,
            _ => Team::Neutral,
        }
    }
    pub fn hostile_to(self, other: Team) -> bool {
        matches!((self, other), (Team::Union, Team::Aszendenz) | (Team::Aszendenz, Team::Union))
    }
}

/// A ship (fighter or capital). Moves along its local +Z at `speed` (flight.rs integrates it).
#[derive(Component, Clone, Debug)]
pub struct Ship {
    pub kind: String,
    pub def: ShipDef,
    pub name: String,
    pub team: Team,
    pub hp: f32,
    pub max_hp: f32,
    pub shield: f32,
    pub max_shield: f32,
    /// current forward speed (m/s)
    pub speed: f32,
    /// seconds until the guns may fire again
    pub cool: f32,
    /// seconds since the shield was last hit (it recharges after a pause)
    pub shield_t: f32,
    pub missiles: u32,
    /// visual bank angle (rad), set by whoever steers the ship
    pub bank: f32,
}

impl Ship {
    pub fn new(kind: &str, def: &ShipDef) -> Self {
        Self {
            kind: kind.to_string(),
            name: def.name.clone(),
            team: Team::from_def(def.team),
            hp: def.hp,
            max_hp: def.hp,
            shield: def.shield,
            max_shield: def.shield,
            speed: def.speed,
            cool: 0.0,
            shield_t: 0.0,
            missiles: def.missiles,
            bank: 0.0,
            def: def.clone(),
        }
    }
    pub fn capital(&self) -> bool {
        self.def.capital
    }
    pub fn radius(&self) -> f32 {
        self.def.radius.max(4.0)
    }
}

/// The visual model lives on a child entity (so banking does not tilt the flight direction).
#[derive(Component)]
pub struct ShipBody;

/// Engine nozzle on a ship model (child of the body): fx.rs draws plumes and trails here.
#[derive(Component, Clone, Copy)]
pub struct EngineNozzle {
    pub radius: f32,
}

/// The local human pilot.
#[derive(Component, Default, Clone, Debug)]
pub struct Player {
    /// 0..1, set with Q/E or the mouse wheel
    pub throttle: f32,
    /// boost energy 0..1
    pub energy: f32,
    pub boosting: bool,
    pub impulse: bool,
    /// 0..1 while the impulse drive spools up
    pub impulse_prog: f32,
    pub target: Option<Entity>,
    /// 0..1 neutron cannon seeker lock on `target`
    pub lock: f32,
    /// speed the ship is accelerating towards (for the HUD speed tape)
    pub want_speed: f32,
    pub kills: u32,
    pub shots: u32,
    pub hits: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum View {
    #[default]
    Cockpit,
    Chase,
}

/// Computer-controlled ship (enemy, wingman, convoy, capital). Logic in ai.rs.
#[derive(Component, Clone, Debug, Default)]
pub struct Ai {
    pub target: Option<Entity>,
    pub skill: f32,
    /// flies on the player's wing and talks
    pub wingman: bool,
    /// character key for radio lines (wingman)
    pub who: Option<String>,
    /// fixed destination (convoy, courier) instead of fighting
    pub dest: Option<Vec3>,
}

/// Something that can be hit: sphere radius, or for capitals an oriented box (half extents) as well.
#[derive(Component, Clone, Copy, Debug)]
pub struct Hittable {
    pub radius: f32,
    pub half_extents: Option<Vec3>,
}

/// Ship is exploding (removed after `t` runs out). Set by weapons.rs when hp reaches 0.
#[derive(Component)]
pub struct Dying {
    pub t: f32,
}

// ---------- messages between modules ----------

/// Damage to a ship. Sent by weapons/collisions, applied by weapons.rs.
#[derive(Message, Clone, Copy, Debug)]
pub struct DamageMsg {
    pub target: Entity,
    pub amount: f32,
    pub source: Option<Entity>,
    pub point: Vec3,
}

/// A ship was destroyed (sent once, by weapons.rs). mission.rs counts it, hud/audio react.
#[derive(Message, Clone, Debug)]
pub struct KilledMsg {
    pub entity: Entity,
    pub kind: String,
    pub team: Team,
    pub by_player: bool,
    /// where it died (for future effects/scoring popups)
    #[allow(dead_code)]
    pub pos: Vec3,
}

/// Visual explosion (fx.rs). size 1 = fighter, 3+ = capital.
#[derive(Message, Clone, Copy, Debug)]
pub struct ExplodeMsg {
    pub pos: Vec3,
    pub size: f32,
}

/// A hit landed: shield flash or hull sparks (fx.rs, audio.rs).
#[derive(Message, Clone, Copy, Debug)]
pub struct HitFxMsg {
    pub pos: Vec3,
    pub ship: Entity,
    pub shield: bool,
    pub color: LinearRgba,
}

/// Radio line shown in the comm box (hud.rs). `who` = character key.
#[derive(Message, Clone, Debug)]
pub struct CommMsg {
    pub who: String,
    pub text: String,
}

/// Sound effect request (audio.rs).
#[derive(Message, Clone, Copy, Debug, PartialEq)]
pub enum SfxMsg {
    Laser { enemy: bool },
    Lance,
    LanceCharge,
    Explosion { size: f32 },
    ShieldHit,
    HullHit,
    Lock,
    Beep,
    Warp,
    Comm,
    UiMove,
    UiOk,
}

/// Mission outcome, sent by mission.rs; menu.rs shows the debrief.
#[derive(Message, Clone, Debug)]
pub struct MissionEndMsg {
    pub win: bool,
    pub reason: String,
}

// ---------- shared resources ----------

/// What the HUD shows about the mission (owner: mission.rs).
#[derive(Resource, Default, Clone, Debug)]
pub struct MissionStatus {
    pub mission: usize,
    pub objective: String,
    /// current nav point position, if the player should fly somewhere
    pub nav_pos: Option<Vec3>,
    pub nav_name: String,
    pub hostiles: usize,
    pub timer: Option<f32>,
    /// autopilot jump available (no enemies, nav far away)
    pub auto_available: bool,
    /// extra markers: (position, label, rgb)
    pub markers: Vec<(Vec3, String, [f32; 3])>,
    pub ended: Option<MissionEndMsg>,
    /// the active nav is the mission's final showdown (aces no longer jump out)
    pub final_nav: bool,
}

/// Which mission to fly next and the player's progress (owner: menu.rs; saved to disk).
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    pub callsign: String,
    pub current: usize,
    pub unlocked: usize,
    pub total_kills: u32,
}

impl Default for Progress {
    fn default() -> Self {
        Self { callsign: "Nova".into(), current: 0, unlocked: 0, total_kills: 0 }
    }
}

/// Upscaling / anti-aliasing choice. DLSS needs an NVIDIA RTX card (Vulkan backend); without it TAA is used.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Upscaling {
    /// DLSS picks the ratio from the output resolution
    #[default]
    DlssAuto,
    /// DLSS anti-aliasing at native resolution
    Dlaa,
    DlssQuality,
    DlssBalanced,
    DlssPerformance,
    DlssUltraPerformance,
    /// no DLSS: temporal anti-aliasing at native resolution
    Taa,
    /// no DLSS, no TAA: fast approximate AA only
    Fxaa,
}

impl Upscaling {
    pub const ALL: [Upscaling; 8] = [
        Upscaling::DlssAuto,
        Upscaling::Dlaa,
        Upscaling::DlssQuality,
        Upscaling::DlssBalanced,
        Upscaling::DlssPerformance,
        Upscaling::DlssUltraPerformance,
        Upscaling::Taa,
        Upscaling::Fxaa,
    ];
    pub fn is_dlss(self) -> bool {
        !matches!(self, Upscaling::Taa | Upscaling::Fxaa)
    }
    pub fn label(self) -> &'static str {
        match self {
            Upscaling::DlssAuto => "DLSS Auto",
            Upscaling::Dlaa => "DLAA (nativ, beste Kantenglättung)",
            Upscaling::DlssQuality => "DLSS Qualität",
            Upscaling::DlssBalanced => "DLSS Ausgewogen",
            Upscaling::DlssPerformance => "DLSS Leistung",
            Upscaling::DlssUltraPerformance => "DLSS Ultra-Leistung",
            Upscaling::Taa => "TAA (ohne DLSS)",
            Upscaling::Fxaa => "FXAA (schnell)",
        }
    }
}

/// Player settings (owner: menu.rs; saved to disk, applied by render.rs / flight.rs / audio.rs).
#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub upscaling: Upscaling,
    pub view: View,
    /// invert pitch (stick style: down = nose up)
    pub invert: bool,
    /// mouse / stick sensitivity multiplier
    pub sensitivity: f32,
    pub master_volume: f32,
    pub music: bool,
    pub fullscreen: bool,
    pub bloom: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            upscaling: Upscaling::DlssAuto,
            view: View::Cockpit,
            invert: false,
            sensitivity: 1.0,
            master_volume: 0.8,
            music: true,
            fullscreen: true,
            bloom: true,
        }
    }
}

/// Set by render.rs: whether DLSS Super Resolution works on this machine (shown in the settings).
#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct DlssAvailable(pub bool);

/// Directory for settings/progress: %APPDATA%\Sternenfront on Windows, ~/.config/sternenfront elsewhere.
pub fn save_dir() -> std::path::PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(std::path::PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = base.join(if cfg!(windows) { "Sternenfront" } else { "sternenfront" });
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn load_json<T: for<'a> Deserialize<'a> + Default>(name: &str) -> T {
    std::fs::read_to_string(save_dir().join(name)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_json<T: Serialize>(name: &str, v: &T) {
    if let Ok(s) = serde_json::to_string_pretty(v) {
        let _ = std::fs::write(save_dir().join(name), s);
    }
}

/// `{cs}` -> callsign
pub fn fill_callsign(text: &str, cs: &str) -> String {
    text.replace("{cs}", cs)
}

/// Main 3D camera (owner: render.rs, follows the player).
#[derive(Component)]
pub struct MainCamera;

/// Forward direction of a transform (+Z is forward for ships, as in the web version).
pub fn fwd(t: &Transform) -> Vec3 {
    t.rotation * Vec3::Z
}

/// Game paused (Esc). Toggled by flight.rs input, shown by menu.rs (pause overlay); while true nothing moves.
#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct Paused(pub bool);

/// What a ship wants to fire this frame. Player input (flight.rs) and AI (ai.rs) write it, weapons.rs reads it.
#[derive(Component, Default, Clone, Copy, Debug)]
pub struct Trigger {
    /// lasers / turrets
    pub guns: bool,
    /// neutron cannon (player) or plasma seeker (Aszendenz)
    pub missile: bool,
    /// where the guns should converge (lead point); None = straight ahead
    pub aim: Option<Vec3>,
}

/// Steering request for computer-controlled ships (ai.rs writes, flight.rs turns the ship towards `dir`
/// limited by the ship's turn rate and changes speed towards `speed`).
#[derive(Component, Clone, Copy, Debug)]
pub struct Steer {
    pub dir: Vec3,
    pub speed: f32,
}

impl Default for Steer {
    fn default() -> Self {
        Self { dir: Vec3::Z, speed: 0.0 }
    }
}
