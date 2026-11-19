//! Mission flow (port of src/game.js startMission / updateMission / completeNav / activateNav / spawnWave /
//! spawnPickups / autopilot / mines): carrier, player and wingman, nav points with their objective types,
//! enemy waves, radio lines, timers, fail conditions, return to the carrier, debrief.
//!
//! Test hooks (environment variables, harmless in normal play):
//! - SF_MISSION_LOG=1  print phase / nav / wave changes and the result to stdout
//! - SF_AUTOJUMP=1     use the autopilot whenever it is available (skips the long flights, for screenshots)
//! - SF_AUTOJUMP_DIST=<m> the autopilot stops this far before the nav point (default 2300)
//! - SF_WAVE_DIST=<m> enemy waves jump in this far ahead of the player (dogfight screenshots)
//! - SF_TIMESCALE=<x>  run the game clock x times faster (as far as the frame rate allows: steps are capped)
//! - SF_AUTOWIN=1      cheat: player invulnerable, hostiles vanish one by one, objectives are flown for you;
//!   the game quits after the debrief appears (end-to-end test of every mission)
//! - SF_TEST_KILL=<who>@<s>  destroy the player / protect / convoy / wingman, or run out the timer (`timer`),
//!   after s seconds of mission time (failure paths); the game quits after the debrief
//! - SF_FLAGS=a,b,...  extra story flags for this run (on top of story.json)
//! - SF_TEST_RETURN=1  skip every nav point once the launch is over: straight to the return and landing
//! - SF_NO_BAY=1       start in front of the carrier and "land" by proximity (the web's non-bay fallback)
//! - SF_BAY_FREEZE=<s> the launch countdown stops at s seconds (screenshots of the red / amber phase)
//! - SF_LAND_FREEZE=<z> the player stops once it is at carrier-local z <= this on the final approach, or flying
//!   by hand towards the bay with clearance (screenshots)
//! - SF_BAY_STAY=1     the mission does not end once everybody is parked (screenshots)
//! - SF_BAY_CHASE=1    keep the chase view during the launch (screenshots; the game forces the cockpit)
//! - SF_OUT_FREEZE=<z> the launched player stops once it is at carrier-local z >= this (screenshots)
//!
//! Launch and landing (web startLaunch / startLanding / captureInBay / updateSeq): every mission starts
//! clamped in the TUS Aurora's hangar bay (red: engines pre-heat, amber: clamps release and the bay field
//! drops, green: the pilot flies out through the tube by hand). Back home, landing clearance comes within
//! 1.8 km of the carrier when no enemy fighter is near it; then the pilot either flies into the bay by hand
//! (the tractor beam catches the ship inside the mouth) or presses AUTO for the landing autopilot (waypoints
//! in front of the bow, final approach nose first down the bay's centre line to a stop mark). The mission
//! ends once every living pilot (player and wingman) is parked. The wingman launches behind the player and
//! starts his own landing approach as soon as the clearance comes.

use crate::ai::{AiContext, AiRng, Cruise};
use crate::audio::BeepMsg;
use crate::common::*;
use crate::flight::{in_bay_corridor, rotation_facing as facing, AutopilotRequest, ImpulseBlock, Obstacle, SeqHold, MAX_DT};
use crate::render::{CameraCutMsg, CameraShake};
use crate::ships::{spawn_ship, ShipLibrary, AURORA_BAY as BAY};
use crate::weapons::{CancelSeekersMsg, JumpedOut, Neutron, WeaponsSet};
use bevy::ecs::system::SystemParam;
use bevy::light::NotShadowCaster;
use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::VisibilitySystems;
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;
use std::fmt::Write as _;

pub struct MissionPlugin;

impl Plugin for MissionPlugin {
    fn build(&self, app: &mut App) {
        let test = TestHooks {
            log: env_on("SF_MISSION_LOG") || env_on("SF_AUTOWIN"),
            autowin: env_on("SF_AUTOWIN"),
            autojump: env_on("SF_AUTOJUMP") || env_on("SF_AUTOWIN"),
            wave_dist: std::env::var("SF_WAVE_DIST").ok().and_then(|v| v.parse().ok()),
            jump_dist: std::env::var("SF_AUTOJUMP_DIST").ok().and_then(|v| v.parse().ok()),
            kill: std::env::var("SF_TEST_KILL").ok().and_then(|v| {
                let (who, t) = v.split_once('@')?;
                Some((who.to_string(), t.parse().ok()?))
            }),
            test_return: env_on("SF_TEST_RETURN"),
            no_bay: env_on("SF_NO_BAY"),
            bay_freeze: std::env::var("SF_BAY_FREEZE").ok().and_then(|v| v.parse().ok()),
            land_freeze: std::env::var("SF_LAND_FREEZE").ok().and_then(|v| v.parse().ok()),
            out_freeze: std::env::var("SF_OUT_FREEZE").ok().and_then(|v| v.parse().ok()),
            bay_stay: env_on("SF_BAY_STAY"),
        };
        app            .add_message::<WarpFlashMsg>()
            .init_resource::<MissionState>()
            .init_resource::<StoryFlags>()
            .init_resource::<MissionResult>()
            .init_resource::<ShotMines>()
            .init_resource::<BayStatus>()
            .insert_resource(test)
            .configure_sets(Update, MissionSet.after(WeaponsSet::Dying).run_if(in_state(AppState::Flight)).run_if(not_paused))
            .add_systems(Startup, build_assets)
            .add_systems(Startup, time_scale.run_if(|| std::env::var("SF_TIMESCALE").is_ok()))
            .add_systems(OnEnter(AppState::Flight), start_mission)
            .add_systems(OnExit(AppState::Flight), cleanup)
            .add_systems(
                Update,
                (
                    autowin.run_if(|t: Res<TestHooks>| t.autowin),
                    test_kill.run_if(|t: Res<TestHooks>| t.kill.is_some()),
                    autopilot,
                    count_kills,
                    mine_hits,
                    update_mines,
                    update_mission,
                    bay_seq,
                    jump_outs,
                    keep_alive_after_win,
                    publish_status,
                    finish_mission,
                )
                    .chain()
                    .in_set(MissionSet),
            )
            .add_systems(Update, (spin_pickups, blink_mines, warp_fx).run_if(in_state(AppState::Flight)).run_if(not_paused))
            .add_systems(PostUpdate, face_camera.after(TransformSystems::Propagate).before(VisibilitySystems::VisibilityPropagate))
            .add_systems(Update, quit_after_debrief.run_if(in_state(AppState::Debrief)).run_if(|t: Res<TestHooks>| t.autowin || t.kill.is_some()));
    }
}

fn time_scale(mut time: ResMut<Time<Virtual>>) {
    if let Some(x) = std::env::var("SF_TIMESCALE").ok().and_then(|v| v.parse::<f32>().ok()).filter(|x| *x > 0.0) {
        time.set_relative_speed(x);
    }
}

fn not_paused(p: Res<Paused>) -> bool {
    !p.0
}

fn env_on(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !v.is_empty() && v != "0")
}

// ---------- public API ----------

/// Mission systems (Update, only in flight and not paused).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct MissionSet;


/// Stage of a landing on rails (web `P.landStage`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandStage {
    /// landing autopilot: waypoints round the hull to the approach point in front of the bow
    Approach,
    /// final approach nose first down the bay's centre line to the stop mark
    Final,
    /// set down on the stop mark, clamps on
    Parked,
}

/// Launch / landing state for the HUD, the camera and the sound (owner: mission.rs, written every frame).
/// Hangar coordinates are carrier-local (`ships::AURORA_BAY`).
#[derive(Resource, Default, Clone, Debug)]
pub struct BayStatus {
    /// the carrier, while it is alive
    pub carrier: Option<Transform>,
    /// launch countdown (seconds since the start) while the player is still clamped:
    /// red until 1.2 s, amber until `LAUNCH_GO`, then green
    pub launch_t: Option<f32>,
    /// released by the launch, still inside the tube ("START FREI")
    pub in_bay: bool,
    /// the player is on the landing rails: stage and stop mark (carrier-local z)
    pub landing: Option<(LandStage, f32)>,
    /// cleared to land and flying by hand: approach guidance (beam rings, bay marker, ILS needles)
    pub land_clear: bool,
    /// everybody parked: the drive is shut down
    pub engine_off: bool,
    /// the player is inside the hangar tube (no sun flare in there)
    pub inside: bool,
    /// the player's position in carrier coordinates (for the guidance displays)
    pub local: Vec3,
}

/// Launch: the lamps turn green (own thrust) this many seconds after the start (red -> amber at 1.2 s).
pub const LAUNCH_GO: f32 = 2.6;

/// Story flags from earlier missions and dialogue choices. They switch conditional wave entries
/// (`["klinge", 1, "holtEscaped"]`) and radio lines (`if` / `ifNot`). mission.rs fills this from
/// `StorySave` (story.json) when a mission starts.
#[derive(Resource, Default, Clone, Debug)]
pub struct StoryFlags(pub HashSet<String>);

/// Persistent story state (web `save.flags`, `save.aff`, `save.score`), saved as `STORY_FILE` in `save_dir()`.
/// Owner: menu.rs (it applies the mission results); mission.rs only reads it at mission start.
#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
pub struct StorySave {
    /// story flags that are set (web: `save.flags[k] === true`)
    pub flags: BTreeSet<String>,
    /// wingman affinity from dialogue choices (web `save.aff`)
    pub aff: BTreeMap<String, i32>,
    /// campaign score (web `save.score`)
    pub score: u32,
}

pub const STORY_FILE: &str = "story.json";

impl StorySave {
    /// Web launch(): `min(0.92, 0.7 + 0.06 * aff[who])`.
    pub fn wing_skill(&self, who: &str) -> f32 {
        (0.7 + 0.06 * self.aff.get(who).copied().unwrap_or(0) as f32).min(0.92)
    }
}

/// Web wingFor(): the wingman who actually flies this mission. Kolibri is replaced by Juno once she is lost
/// (or captured and not rescued), Rook once he is dead.
/// `f(k)` tells whether story flag `k` is set.
pub fn wing_for(m: &Mission, f: impl Fn(&str) -> bool) -> Option<String> {
    let mut w = m.wingman.clone().filter(|w| !w.is_empty())?;
    if w == "kolibri" && (f("kolibriLost") || (f("kolibriCaptured") && !f("kolibriSaved"))) {
        w = "juno".into();
    }
    if w == "rook" && f("rookDead") {
        w = "juno".into();
    }
    Some(w)
}

/// Statistics of the last finished mission (for the debrief screen, menu.rs).
#[allow(dead_code)]
#[derive(Resource, Default, Clone, Debug)]
pub struct MissionResult {
    pub mission: usize,
    pub win: bool,
    pub reason: String,
    /// the player died (retry) rather than failing an objective (story may branch)
    pub death: bool,
    /// kills by the player on Aszendenz ships
    pub kills: u32,
    pub shots: u32,
    pub hits: u32,
    /// web stats.score: `def.score || 100` per player kill on an Aszendenz ship
    pub score: u32,
    pub time: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Phase {
    /// flying to the current nav point
    #[default]
    Travel,
    /// at the nav point: waves, objective
    Fight,
    /// all navs done, fly back to the carrier
    Return,
    /// mission won, radio lines play out
    Done,
}

/// Live mission state (owner: mission.rs). Other modules may read it (e.g. flight.rs for the impulse drive).
#[derive(Resource, Default)]
pub struct MissionState {
    pub phase: Phase,
    pub nav_idx: usize,
    pub wave: usize,
    pub timer: Option<f32>,
    /// position the player should fly to right now (nav point, protected ship, carrier)
    pub nav_target: Option<Vec3>,
    /// the current nav is an escape run (no impulse drive, no autopilot)
    pub escape: bool,
    pub carrier: Option<Entity>,
    pub protect: Option<Entity>,
    pub wingman: Option<Entity>,
    pub player: Option<Entity>,
    pub kills: u32,
    pub score: u32,
    /// the player's shots / hits, copied every frame while the player lives (the entity is gone at the end)
    pub shots: u32,
    pub hits: u32,
    pub time: f32,
    wave_t: Option<f32>,
    prog: f32,
    surv: f32,
    convoy: Vec<Entity>,
    convoy_alive: usize,
    convoy_follow: bool,
    courier: Option<(Entity, Vec3)>,
    prison: Option<Entity>,
    docking: bool,
    dock_wave: bool,
    cap_seen: bool,
    fail: Option<String>,
    fail_t: f32,
    end_t: f32,
    dead_t: Option<f32>,
    land_clear: bool,
    land_warned: bool,
    pickups_total: usize,
    pickups_got: usize,
    outcome: Option<(bool, String, bool)>,
    ended: bool,
    navs: Arc<Vec<NavPlan>>,
    no_return: bool,
    protect_carrier: bool,
    mission_idx: usize,
    /// launch from / landing in the hangar (web `useBay`)
    use_bay: bool,
    /// running launch or landing sequence (web `game.seq`)
    seq: Option<Seq>,
    /// player (first) and wingman in the hangar sequences
    bay: Vec<BayPilot>,
    /// the view before the launch forced the cockpit (restored once the player is out of the tube)
    view_saved: Option<View>,
    /// the player asked for the landing autopilot (handled by `bay_seq`)
    want_landing: bool,
    engine_off: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SeqKind {
    Launch,
    Land,
}

#[derive(Clone, Copy, Debug)]
struct Seq {
    kind: SeqKind,
    t: f32,
    /// launch lamps: 0 red, 1 amber, 2 green
    light: u8,
    /// landing: everybody parked at this sequence time
    done_t: Option<f32>,
}

/// A pilot in the hangar sequences (web `P.seqHold`, `P.seqZ`, `P.inBay`, `P.landStage`, `P.landStop`, `P.landWps`).
#[derive(Clone, Debug)]
struct BayPilot {
    e: Entity,
    player: bool,
    /// on rails (mirrored as the `SeqHold` component)
    held: bool,
    /// launch: stop mark the ship is clamped on (carrier-local z)
    launch_z: f32,
    /// launch: released, still in the tube
    in_bay: bool,
    /// launch: out of the tube
    out: bool,
    /// wingman launch: scripted speed along the tube
    v: f32,
    stage: Option<LandStage>,
    stop: Option<f32>,
    /// landing autopilot waypoints (carrier-local)
    wps: Vec<Vec3>,
    /// parked: attitude relative to the carrier
    park_rot: Quat,
    /// SF_LAND_FREEZE: carrier-local position and attitude the landing stopped at
    frozen: Option<(Vec3, Quat)>,
}

impl BayPilot {
    fn new(e: Entity, player: bool, launch_z: f32) -> Self {
        Self { e, player, held: false, launch_z, in_bay: false, out: false, v: 0.0, stage: None, stop: None, wps: Vec::new(), park_rot: Quat::IDENTITY, frozen: None }
    }
}

// ---------- parsed mission data ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NavKind {
    Clear,
    Pickup,
    Scan,
    Convoy,
    Survive,
    Escape,
    Intercept,
    Dock,
}

impl NavKind {
    fn parse(s: Option<&str>) -> Self {
        match s {
            Some("pickup") => Self::Pickup,
            Some("scan") => Self::Scan,
            Some("convoy") => Self::Convoy,
            Some("survive") => Self::Survive,
            Some("escape") => Self::Escape,
            Some("intercept") => Self::Intercept,
            Some("dock") => Self::Dock,
            // "clear", no type, or anything this version does not know: fight the waves
            _ => Self::Clear,
        }
    }
}

#[derive(Clone, Debug)]
struct ScriptLine {
    who: String,
    text: String,
    cond_if: Option<String>,
    cond_not: Option<String>,
}

/// [ship type, count, story flag that must be set]
#[derive(Clone, Debug)]
struct Entry {
    kind: String,
    n: u32,
    cond: Option<String>,
}

#[derive(Clone, Debug)]
struct NavPlan {
    name: String,
    pos: Vec3,
    kind: NavKind,
    objective: Option<String>,
    anchor: bool,
    is_final: bool,
    waves: Vec<Vec<Entry>>,
    limit: Option<f32>,
    limit_fail: Option<String>,
    timer_fail: Option<String>,
    fail_text: Option<String>,
    scan: f32,
    pickups: usize,
    pickup_label: String,
    survive: f32,
    escape: f32,
    chasers: Vec<Entry>,
    convoy_types: Vec<String>,
    convoy_speed: Option<f32>,
    convoy_to: Option<Vec3>,
    intercept_to: Vec3,
    intercept_fast_if_not: Option<String>,
    dock: f32,
    dock_wave: Vec<Entry>,
    mines: Option<(Option<Vec3>, usize, f32)>,
    wreck: bool,
    on_arrive: Vec<ScriptLine>,
    on_clear: Vec<ScriptLine>,
    on_wave: Vec<Option<ScriptLine>>,
    on_dock: Vec<ScriptLine>,
}

fn vec3_of(v: Option<&Value>) -> Option<Vec3> {
    let a = v?.as_array()?;
    let f = |i: usize| a.get(i).and_then(Value::as_f64).map(|x| x as f32);
    Some(Vec3::new(f(0)?, f(1)?, f(2)?))
}

fn f32_of(v: Option<&Value>) -> Option<f32> {
    v.and_then(Value::as_f64).map(|x| x as f32)
}

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_string)
}

fn line_of(v: &Value) -> Option<ScriptLine> {
    let o = v.as_object()?;
    Some(ScriptLine {
        who: str_of(o.get("who")).unwrap_or_default(),
        text: str_of(o.get("text")).unwrap_or_default(),
        cond_if: str_of(o.get("if")),
        cond_not: str_of(o.get("ifNot")),
    })
}

fn lines_of(v: Option<&Value>) -> Vec<Option<ScriptLine>> {
    v.and_then(Value::as_array).map(|a| a.iter().map(line_of).collect()).unwrap_or_default()
}

fn group_of(v: Option<&Value>) -> Vec<Entry> {
    let Some(a) = v.and_then(Value::as_array) else { return Vec::new() };
    a.iter()
        .filter_map(|e| {
            let e = e.as_array()?;
            Some(Entry {
                kind: e.first()?.as_str()?.to_string(),
                n: e.get(1).and_then(Value::as_u64).unwrap_or(1) as u32,
                cond: e.get(2).and_then(Value::as_str).map(str::to_string),
            })
        })
        .collect()
}

impl NavPlan {
    /// `raw` is the nav's JSON as written in campaign.json (keeps the `if`/`ifNot` of onArrive/onClear lines).
    fn from(nav: &Nav, raw: Option<&Value>) -> Self {
        let x = &nav.extra;
        let get = |k: &str| x.get(k);
        let typed = |ls: &[Line]| ls.iter().map(|l| ScriptLine { who: l.who.clone(), text: l.text.clone(), cond_if: None, cond_not: None }).collect();
        let from_raw = |k: &str| raw.and_then(|r| r.get(k)).map(|v| lines_of(Some(v)).into_iter().flatten().collect::<Vec<_>>());
        let convoy = get("convoy");
        let intercept = get("intercept");
        let mines = get("mines").map(|m| {
            (vec3_of(m.get("at")), m.get("n").and_then(Value::as_u64).unwrap_or(0) as usize, f32_of(m.get("spread")).unwrap_or(600.0))
        });
        Self {
            name: nav.name.clone(),
            pos: Vec3::from(nav.pos),
            kind: NavKind::parse(nav.kind.as_deref()),
            objective: nav.objective.clone(),
            anchor: get("anchor").and_then(Value::as_bool).unwrap_or(false),
            is_final: get("final").and_then(Value::as_bool).unwrap_or(false),
            waves: get("waves").and_then(Value::as_array).map(|w| w.iter().map(|g| group_of(Some(g))).collect()).unwrap_or_default(),
            limit: f32_of(get("limit")),
            limit_fail: str_of(get("limitFail")),
            timer_fail: str_of(get("timerFail")),
            fail_text: str_of(get("failText")),
            scan: f32_of(get("scan")).unwrap_or(10.0),
            pickups: get("pickups").and_then(Value::as_u64).unwrap_or(0) as usize,
            pickup_label: str_of(get("pickupLabel")).unwrap_or_else(|| "DATENKERN".into()),
            survive: f32_of(get("survive")).unwrap_or(120.0),
            escape: f32_of(get("escape")).unwrap_or(240.0),
            chasers: group_of(get("chasers")),
            convoy_types: convoy
                .and_then(|c| c.get("types"))
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect())
                .unwrap_or_default(),
            convoy_speed: convoy.and_then(|c| f32_of(c.get("speed"))),
            convoy_to: convoy.and_then(|c| vec3_of(c.get("to"))),
            intercept_to: intercept.and_then(|i| vec3_of(i.get("to"))).unwrap_or(Vec3::from(nav.pos) + Vec3::new(0.0, 0.0, 8000.0)),
            intercept_fast_if_not: intercept.and_then(|i| str_of(i.get("fastIfNot"))),
            dock: f32_of(get("dock")).unwrap_or(8.0),
            dock_wave: group_of(get("dockWave")),
            mines: mines.filter(|m| m.1 > 0),
            wreck: get("wreck").and_then(Value::as_bool).unwrap_or(false),
            on_arrive: from_raw("onArrive").unwrap_or_else(|| typed(&nav.on_arrive)),
            on_clear: from_raw("onClear").unwrap_or_else(|| typed(&nav.on_clear)),
            on_wave: lines_of(get("onWave")),
            on_dock: lines_of(get("onDock")).into_iter().flatten().collect(),
        }
    }
}

// ---------- entities owned by this module ----------

#[derive(Component)]
struct Pickup;

/// A live mine (cockpit MINE lamp and radar use it).
#[derive(Component)]
pub struct Mine {
    phase: f32,
    /// a Union ship is in range (fast blink)
    active: bool,
}

#[derive(Component)]
struct MineGlow;

#[derive(Component)]
struct WarpFlash {
    t: f32,
    life: f32,
    size: f32,
    material: Handle<StandardMaterial>,
}

/// Internal: blue jump flash where a ship leaves (or arrives).
#[derive(Message, Clone, Copy)]
struct WarpFlashMsg {
    pos: Vec3,
    size: f32,
}

#[derive(Resource)]
struct MissionAssets {
    mine_mesh: Handle<Mesh>,
    spike_mesh: Handle<Mesh>,
    mine_mat: Handle<StandardMaterial>,
    /// unit quad for camera-facing glows (`Billboard`)
    glow_mesh: Handle<Mesh>,
    glow: Handle<Image>,
    mine_glow_mat: Handle<StandardMaterial>,
    pickup_mesh: Handle<Mesh>,
    pickup_mat: Handle<StandardMaterial>,
    pickup_glow_mat: Handle<StandardMaterial>,
}

#[derive(Resource, Clone, Default)]
struct TestHooks {
    log: bool,
    /// SF_TEST_KILL: (player | protect | convoy | wingman, mission seconds)
    kill: Option<(String, f32)>,
    wave_dist: Option<f32>,
    /// SF_AUTOJUMP_DIST: autopilot stops this far before the nav instead of 2.3 km
    jump_dist: Option<f32>,
    autowin: bool,
    autojump: bool,
    /// SF_TEST_RETURN: straight to the landing once launched
    test_return: bool,
    /// SF_NO_BAY: no hangar launch / landing
    no_bay: bool,
    /// SF_BAY_FREEZE: launch countdown stops at this sequence time
    bay_freeze: Option<f32>,
    /// SF_LAND_FREEZE: the player's landing stops at this carrier-local z
    land_freeze: Option<f32>,
    /// SF_OUT_FREEZE: the launched player stops at this carrier-local z
    out_freeze: Option<f32>,
    /// SF_BAY_STAY: stay parked, no mission end
    bay_stay: bool,
}

const WARP_POOL: usize = 8;
const ENEMY_TOUGH: f32 = 1.7;
const COL_GREEN: [f32; 3] = [0.43, 1.0, 0.69];
const COL_GOLD: [f32; 3] = [1.0, 0.78, 0.34];
const COL_RED: [f32; 3] = [1.0, 0.3, 0.43];

/// Soft round glow (premultiplied: rgb = alpha), for the camera-facing glow quads.
fn glow_image() -> Image {
    const N: usize = 64;
    let mut px = Vec::with_capacity(N * N * 4);
    for y in 0..N {
        for x in 0..N {
            let d = Vec2::new(x as f32 + 0.5 - N as f32 * 0.5, y as f32 + 0.5 - N as f32 * 0.5).length() / (N as f32 * 0.5);
            let a = ((1.0 - d).max(0.0).powi(2) * 0.75 + (-d * d * 28.0).exp() * 0.25).min(1.0);
            let v = (a * 255.0).round() as u8;
            px.extend_from_slice(&[v, v, v, v]);
        }
    }
    Image::new(
        Extent3d { width: N as u32, height: N as u32, depth_or_array_layers: 1 },
        TextureDimension::D2,
        px,
        TextureFormat::Rgba8Unorm,
        RenderAssetUsages::RENDER_WORLD,
    )
}

fn glow_material(glow: &Handle<Image>, c: LinearRgba) -> StandardMaterial {
    StandardMaterial {
        base_color: Color::LinearRgba(c),
        base_color_texture: Some(glow.clone()),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        fog_enabled: false,
        double_sided: true,
        cull_mode: None,
        ..default()
    }
}

fn build_assets(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>, mut images: ResMut<Assets<Image>>) {
    let ico = |r: f32, sub: u32| Sphere::new(r).mesh().ico(sub).unwrap_or_else(|_| Sphere::new(r).mesh().build());
    let mine_mesh = meshes.add(ico(3.0, 0));
    let spike_mesh = meshes.add(Cone { radius: 0.8, height: 4.0 });
    let glow_mesh = meshes.add(Rectangle::new(1.0, 1.0));
    let glow = images.add(glow_image());
    let pickup_mesh = meshes.add(ico(3.2, 0));
    let mine_mat = mats.add(StandardMaterial {
        base_color: Color::srgb(0.16, 0.10, 0.13),
        metallic: 0.8,
        perceptual_roughness: 0.35,
        emissive: LinearRgba::rgb(0.5, 0.05, 0.1),
        ..default()
    });
    let mine_glow_mat = mats.add(glow_material(&glow, LinearRgba::rgb(6.0, 0.6, 0.45)));
    let pickup_mat = mats.add(StandardMaterial {
        base_color: Color::srgb(0.3, 1.0, 0.6),
        emissive: LinearRgba::rgb(1.2, 6.0, 2.8),
        unlit: true,
        ..default()
    });
    let pickup_glow_mat = mats.add(glow_material(&glow, LinearRgba::rgb(0.8, 3.6, 1.6)));
    commands.insert_resource(MissionAssets { mine_mesh, spike_mesh, mine_mat, glow_mesh, glow, mine_glow_mat, pickup_mesh, pickup_mat, pickup_glow_mat });
}

// ---------- spawning ----------

#[derive(SystemParam)]
struct Spawner<'w, 's> {
    commands: Commands<'w, 's>,
    lib: Res<'w, ShipLibrary>,
    data: Res<'w, GameData>,
    rng: ResMut<'w, AiRng>,
    flags: ResMut<'w, StoryFlags>,
}

#[derive(SystemParam)]
struct Radio<'w> {
    comm: MessageWriter<'w, CommMsg>,
    sfx: MessageWriter<'w, SfxMsg>,
    banner: MessageWriter<'w, crate::hud::HudBanner>,
    warp: MessageWriter<'w, WarpFlashMsg>,
    cancel_seekers: MessageWriter<'w, CancelSeekersMsg>,
    progress: Res<'w, Progress>,
    test: Res<'w, TestHooks>,
}

impl Radio<'_> {
    fn say(&mut self, who: &str, text: &str) {
        self.comm.write(CommMsg { who: who.to_string(), text: fill_callsign(text, &self.progress.callsign) });
    }
    fn script(&mut self, lines: &[ScriptLine], flags: &StoryFlags) {
        for l in lines {
            if passes(l, flags) {
                self.say(&l.who, &l.text);
            }
        }
    }
    fn banner(&mut self, text: &str) {
        self.banner.write(crate::hud::HudBanner(text.to_string()));
    }
    fn log(&self, text: impl FnOnce() -> String) {
        if self.test.log {
            println!("[mission] {}", text());
        }
    }
}

fn passes(l: &ScriptLine, flags: &StoryFlags) -> bool {
    l.cond_if.as_ref().is_none_or(|f| flags.0.contains(f)) && l.cond_not.as_ref().is_none_or(|f| !flags.0.contains(f))
}

/// Spawn a computer-controlled ship facing `dir`. Enemy fighters get the web's ENEMY_TOUGH hull bonus.
fn spawn_ai_ship(sp: &mut Spawner, kind: &str, pos: Vec3, dir: Vec3, ai: Ai, name: Option<String>, speed: Option<f32>) -> Entity {
    let def = sp.data.ship(kind).clone();
    let tf = Transform::from_translation(pos).with_rotation(facing(dir, Vec3::Y));
    let e = spawn_ship(&mut sp.commands, &sp.lib, &sp.data, kind, tf);
    let mut ship = Ship::new(kind, &def);
    if ship.team == Team::Aszendenz && !def.capital {
        ship.hp *= ENEMY_TOUGH;
        ship.max_hp *= ENEMY_TOUGH;
        ship.shield *= ENEMY_TOUGH;
        ship.max_shield *= ENEMY_TOUGH;
    }
    ship.cool = sp.rng.range(0.0, 0.5);
    ship.speed = speed.unwrap_or(def.speed * 0.8);
    if let Some(n) = name {
        ship.name = n;
    }
    let steer = Steer { dir: tf.rotation * Vec3::Z, speed: ship.speed };
    sp.commands.entity(e).insert((ship, steer, Trigger::default(), ai));
    e
}

fn spawn_group(sp: &mut Spawner, radio: &mut Radio, entries: &[Entry], origin: Vec3, center: Vec3) -> usize {
    let mut n = 0;
    for en in entries {
        if en.cond.as_ref().is_some_and(|c| !sp.flags.0.contains(c)) {
            continue;
        }
        let cap = sp.data.ship(&en.kind).capital;
        for _ in 0..en.n {
            let pos = if cap { origin } else { origin + Vec3::new(sp.rng.range(-1.0, 1.0), sp.rng.range(-1.0, 1.0), sp.rng.range(-1.0, 1.0)) * 160.0 };
            let dir = (center - pos).normalize_or(Vec3::Z);
            spawn_ai_ship(sp, &en.kind, pos, dir, Ai::default(), None, None);
            if !cap {
                radio.warp.write(WarpFlashMsg { pos, size: 90.0 });
            }
            n += 1;
        }
    }
    n
}

/// Web spawnWave(): fighters jump in 1.5 km (2.6 km around a protected ship) from the centre, capitals at the nav.
fn spawn_wave(sp: &mut Spawner, radio: &mut Radio, nav: &NavPlan, idx: usize, center: Vec3, player: Option<Vec3>, cycle_end: bool) {
    let mut base = sp.rng.dir();
    base.y *= 0.35;
    let base = base.normalize_or(Vec3::X);
    let mut origin = center + base * if nav.anchor { 2600.0 } else { 1500.0 };
    if player.is_some_and(|p| p.distance(origin) < 1300.0) {
        origin += base * 1300.0;
    }
    // test hook SF_WAVE_DIST: waves jump in this far ahead of the player (screenshots of a dogfight)
    if let (Some(d), Some(p)) = (radio.test.wave_dist, player) {
        origin = p + (center - p).normalize_or(Vec3::Z) * d;
    }
    let Some(wave) = nav.waves.get(idx) else { return };
    let mut count = 0;
    for en in wave {
        if en.cond.as_ref().is_some_and(|c| !sp.flags.0.contains(c)) {
            continue;
        }
        let cap = sp.data.ship(&en.kind).capital;
        for _ in 0..en.n {
            let (pos, dir) = if cap {
                (nav.pos, Vec3::new(1.0, 0.0, 0.2).normalize())
            } else {
                let p = origin + Vec3::new(sp.rng.range(-1.0, 1.0), sp.rng.range(-1.0, 1.0), sp.rng.range(-1.0, 1.0)) * 160.0;
                (p, (center - p).normalize_or(Vec3::Z))
            };
            let name = match en.kind.as_str() {
                "zerstoerer" => Some("Dogma".to_string()),
                "station" | "relay" if !nav.name.is_empty() => Some(nav.name.clone()),
                _ => None,
            };
            spawn_ai_ship(sp, &en.kind, pos, dir, Ai::default(), name, None);
            if !cap {
                radio.warp.write(WarpFlashMsg { pos, size: 90.0 });
            }
            count += 1;
        }
    }
    radio.log(|| format!("nav '{}' wave {} spawned ({} ships)", nav.name, idx, count));
    if idx > 0 {
        radio.sfx.write(SfxMsg::Beep);
        radio.banner("NEUE FEINDWELLE");
    }
    if !cycle_end {
        if let Some(Some(l)) = nav.on_wave.get(idx) {
            if passes(l, &sp.flags) {
                let l = l.clone();
                radio.say(&l.who, &l.text);
            }
        }
    }
}

/// Web spawnPickups(): spread around the nav, clear of rocks and capital hulls.
fn spawn_pickups(commands: &mut Commands, assets: &MissionAssets, rng: &mut AiRng, nav: &NavPlan, solid: &[(Vec3, f32)]) -> usize {
    for i in 0..nav.pickups {
        let a = (i as f32 / nav.pickups as f32) * std::f32::consts::TAU + rng.range(-0.3, 0.3);
        let mut pos = nav.pos;
        for tries in 0..40 {
            let r = rng.range(250.0, 520.0 + tries as f32 * 15.0);
            pos = nav.pos + Vec3::new(a.cos() * r, rng.range(-120.0, 120.0), a.sin() * r);
            if solid.iter().all(|&(c, rad)| c.distance(pos) > rad + 70.0) {
                break;
            }
        }
        commands
            .spawn((Pickup, InMission, Transform::from_translation(pos), Visibility::default(), Name::new("Bergungsobjekt")))
            .with_children(|p| {
                p.spawn((Mesh3d(assets.pickup_mesh.clone()), MeshMaterial3d(assets.pickup_mat.clone()), Transform::default(), NotShadowCaster));
                p.spawn((
                    Billboard,
                    Mesh3d(assets.glow_mesh.clone()),
                    MeshMaterial3d(assets.pickup_glow_mat.clone()),
                    Transform::from_scale(Vec3::splat(36.0)),
                    NotShadowCaster,
                ));
            });
    }
    nav.pickups
}

fn lay_mines(commands: &mut Commands, assets: &MissionAssets, rng: &mut AiRng, center: Vec3, n: usize, spread: f32) {
    const AXES: [Vec3; 6] = [Vec3::X, Vec3::NEG_X, Vec3::Y, Vec3::NEG_Y, Vec3::Z, Vec3::NEG_Z];
    for _ in 0..n {
        let pos = center + rng.dir() * rng.f32().cbrt() * spread * Vec3::new(1.0, 0.35, 1.0);
        let rot = Quat::from_euler(EulerRot::XYZ, rng.range(0.0, 6.3), rng.range(0.0, 6.3), rng.range(0.0, 6.3));
        commands
            .spawn((
                Mine { phase: rng.range(0.0, 6.0), active: false },
                // an obstacle stops bolts (weapons.rs reports the impact, see `mine_hits`) and makes the AI steer
                // around it; a live mine blocks the impulse drive within 2.2 km (web IMPULSE.mine). Both go away
                // with the mine entity when it detonates.
                Obstacle { radius: 5.0 },
                ImpulseBlock(2200.0),
                InMission,
                Transform::from_translation(pos).with_rotation(rot),
                Visibility::default(),
                Name::new("Mine"),
            ))
            .with_children(|p| {
                p.spawn((Mesh3d(assets.mine_mesh.clone()), MeshMaterial3d(assets.mine_mat.clone()), Transform::default()));
                for ax in AXES {
                    p.spawn((
                        Mesh3d(assets.spike_mesh.clone()),
                        MeshMaterial3d(assets.mine_mat.clone()),
                        Transform::from_translation(ax * 3.0).with_rotation(Quat::from_rotation_arc(Vec3::Y, ax)),
                    ));
                }
                p.spawn((
                    MineGlow,
                    Billboard,
                    Mesh3d(assets.glow_mesh.clone()),
                    MeshMaterial3d(assets.mine_glow_mat.clone()),
                    Transform::from_scale(Vec3::splat(6.0)),
                    NotShadowCaster,
                ));
            });
    }
}

// ---------- mission start / end ----------

#[allow(clippy::too_many_arguments)]
fn start_mission(
    mut sp: Spawner,
    mut radio: Radio,
    assets: Res<MissionAssets>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut st: ResMut<MissionState>,
    mut status: ResMut<MissionStatus>,
    mut ctx: ResMut<AiContext>,
    mut settings: ResMut<Settings>,
    mut bay_status: ResMut<BayStatus>,
) {
    let idx = radio.progress.current.min(sp.data.campaign.missions.len().saturating_sub(1));
    let m = sp.data.mission(idx).clone();
    // raw JSON of the mission's navs: the typed `Line` drops the `if`/`ifNot` conditions
    let raw: Option<Value> = std::fs::read_to_string(data_dir().join("campaign.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    let raw_navs = raw.as_ref().and_then(|r| r.get("missions")?.get(idx)?.get("navs")?.as_array().cloned());
    let navs: Vec<NavPlan> = m.navs.iter().enumerate().map(|(i, n)| NavPlan::from(n, raw_navs.as_ref().and_then(|a| a.get(i)))).collect();
    let protect_kind = m.extra.get("protect").and_then(Value::as_str).map(str::to_string);

    // story flags (story.json, written by menu.rs) plus the SF_FLAGS test hook
    let story: StorySave = load_json(STORY_FILE);
    sp.flags.0 = story.flags.iter().cloned().collect();
    if let Ok(extra) = std::env::var("SF_FLAGS") {
        sp.flags.0.extend(extra.split(',').map(str::trim).filter(|f| !f.is_empty()).map(str::to_string));
    }

    *st = MissionState {
        mission_idx: idx,
        no_return: m.extra.get("noReturn").and_then(Value::as_bool).unwrap_or(false),
        protect_carrier: protect_kind.as_deref() == Some("carrier"),
        // web: opts.launch is always set by app.js, so every mission starts in the hangar
        use_bay: !radio.test.no_bay,
        ..default()
    };
    // the bay lamps are shared materials: never carry a launch / landing state into the next mission
    sp.lib.bay.reset(&mut mats);
    *bay_status = BayStatus::default();

    // carrier at the origin, cruising slowly along +Z
    let carrier = spawn_ai_ship(&mut sp, "aurora", Vec3::ZERO, Vec3::Z, Ai::default(), None, None);
    let ctf = Transform::from_translation(Vec3::ZERO).with_rotation(facing(Vec3::Z, Vec3::Y));
    st.carrier = Some(carrier);
    if st.protect_carrier {
        st.protect = Some(carrier);
    }

    let wing_who = wing_for(&m, |k| sp.flags.0.contains(k));
    // web startLaunch: the pilots are clamped on the stop marks one behind the other, the first one in front
    let n_pilots = 1 + wing_who.is_some() as usize;
    let launch_z = |i: usize| BAY.back + 16.0 + (n_pilots - 1 - i) as f32 * 36.0;
    let in_bay = |z: f32| ctf.translation + ctf.rotation * Vec3::new(0.0, BAY.y - 0.5, z);

    // the player: clamped in the hangar, or (SF_NO_BAY) launched in front of the carrier
    let ptf = if st.use_bay { Transform::from_translation(in_bay(launch_z(0))).with_rotation(ctf.rotation) } else { Transform::from_xyz(70.0, -4.0, 300.0) };
    let start_speed = if st.use_bay { 0.0 } else { 160.0 };
    let player = spawn_ship(&mut sp.commands, &sp.lib, &sp.data, &m.ship, ptf);
    let mut pship = Ship::new(&m.ship, sp.data.ship(&m.ship));
    pship.speed = start_speed;
    pship.name = radio.progress.callsign.clone();
    sp.commands
        .entity(player)
        .insert((pship, Player { throttle: 0.75, energy: 1.0, want_speed: start_speed, ..default() }, Trigger::default(), Name::new("Spieler")));
    st.player = Some(player);

    // wingman (web wingFor: replaced by Juno when the story lost him or her): same ship type, on the left
    if let Some(who) = wing_who {
        // web: CHARS[who].call ("Rook"); the typed Character has no call sign, so read it from the raw JSON
        let call = raw
            .as_ref()
            .and_then(|r| r.get("chars")?.get(who.as_str())?.get("call")?.as_str().map(str::to_string))
            .unwrap_or_else(|| call_sign(&who));
        let ai = Ai { wingman: true, skill: story.wing_skill(&who), who: Some(who), ..default() };
        let (pos, speed) = if st.use_bay { (in_bay(launch_z(1)), 0.0) } else { (Vec3::new(40.0, -8.0, 270.0), 160.0) };
        st.wingman = Some(spawn_ai_ship(&mut sp, &m.ship, pos, ctf.rotation * Vec3::Z, ai, Some(call), Some(speed)));
    }

    // web startLaunch: everybody clamped, red lamps, field closed; the launch is seen from the cockpit
    if st.use_bay {
        st.bay.push(BayPilot::new(player, true, launch_z(0)));
        if let Some(w) = st.wingman {
            st.bay.push(BayPilot::new(w, false, launch_z(1)));
        }
        for p in &mut st.bay {
            p.held = true;
            sp.commands.entity(p.e).insert(SeqHold { launch: true });
        }
        st.seq = Some(Seq { kind: SeqKind::Launch, t: 0.0, light: 0, done_t: None });
        sp.lib.bay.set_lamps(&mut mats, true, false, false);
        if settings.view != View::Cockpit && !env_on("SF_BAY_CHASE") {
            st.view_saved = Some(settings.view);
            settings.view = View::Cockpit;
        }
    }

    // static nav content: protected ships, wreck, mine fields (asteroids are render.rs)
    for n in &navs {
        if n.anchor && matches!(protect_kind.as_deref(), Some("transport" | "habitat")) {
            let kind = protect_kind.as_deref().unwrap_or("transport");
            st.protect = Some(spawn_ai_ship(&mut sp, kind, n.pos, Vec3::new(0.3, 0.0, 1.0), Ai::default(), None, None));
        }
        if n.wreck {
            spawn_ai_ship(&mut sp, "valkyrie", n.pos, Vec3::new(0.25, -0.12, 1.0), Ai::default(), None, Some(0.0));
        }
        if let Some((at, count, spread)) = n.mines {
            lay_mines(&mut sp.commands, &assets, &mut sp.rng, at.unwrap_or(n.pos), count, spread);
        }
    }
    // pooled jump flashes
    for _ in 0..WARP_POOL {
        let material = mats.add(glow_material(&assets.glow, LinearRgba::BLACK));
        sp.commands.spawn((
            Billboard,
            WarpFlash { t: 0.0, life: 0.6, size: 1.0, material: material.clone() },
            Mesh3d(assets.glow_mesh.clone()),
            MeshMaterial3d(material),
            InMission,
            Transform::from_scale(Vec3::ZERO),
            Visibility::Hidden,
            NotShadowCaster,
        ));
    }

    st.navs = Arc::new(navs);
    *ctx = AiContext { carrier: Some(carrier), protect_carrier: st.protect_carrier, travel: true };
    *status = MissionStatus { mission: idx, ..default() };
    radio.log(|| format!("start mission {} '{}' ({} navs, ship {}, wingman {:?}, flags {:?})", idx, m.title, st.navs.len(), m.ship, wing_for(&m, |k| sp.flags.0.contains(k)), sp.flags.0));
    activate_nav(&mut st, &mut sp, &mut radio, Some(ptf.translation), Vec3::Z);
    if !st.use_bay {
        radio.say("flug", "Startfreigabe erteilt. Klare Bahn, {cs}!");
    } else if st.wingman.is_some() {
        radio.say("flug", "Stellplatz eins und zwei, {cs}: Triebwerke vorglühen, Haltemagnete lösen auf mein Zeichen.");
    } else {
        radio.say("flug", "Stellplatz eins, {cs}: Triebwerke vorglühen, Haltemagnete lösen auf mein Zeichen.");
    }
}

/// Fallback call sign from the character key: "rook" -> "Rook".
fn call_sign(who: &str) -> String {
    let mut c = who.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_else(|| "Flügelmann".into())
}

fn cleanup(
    mut commands: Commands,
    q: Query<Entity, With<InMission>>,
    mut ctx: ResMut<AiContext>,
    mut st: ResMut<MissionState>,
    mut settings: ResMut<Settings>,
    lib: Res<ShipLibrary>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut bay_status: ResMut<BayStatus>,
) {
    for e in &q {
        commands.entity(e).try_despawn();
    }
    *ctx = AiContext::default();
    // a mission left during the launch: give the view back, lamps to idle (the menu backdrop shows the Aurora)
    if let Some(v) = st.view_saved.take() {
        settings.view = v;
    }
    lib.bay.reset(&mut mats);
    *bay_status = BayStatus::default();
}

/// Web activateNav(): escape runs start their timer and the chasers jump in behind the player.
fn activate_nav(st: &mut MissionState, sp: &mut Spawner, radio: &mut Radio, player: Option<Vec3>, player_fwd: Vec3) {
    st.timer = None;
    let navs = st.navs.clone();
    let Some(nav) = navs.get(st.nav_idx) else { return };
    st.escape = nav.kind == NavKind::Escape;
    radio.log(|| format!("nav {} '{}' active ({:?})", st.nav_idx, nav.name, nav.kind));
    if nav.kind == NavKind::Escape {
        st.timer = Some(nav.escape);
        if let (Some(p), false) = (player, nav.chasers.is_empty()) {
            spawn_group(sp, radio, &nav.chasers, p - player_fwd * 1400.0, p);
        }
    }
}

// ---------- per-frame systems ----------

/// Web kill(): a player kill on an Aszendenz ship counts, scores `def.score || 100` and gets a banner.
fn count_kills(mut kills: MessageReader<KilledMsg>, mut st: ResMut<MissionState>, data: Res<GameData>, mut banner: MessageWriter<crate::hud::HudBanner>) {
    for k in kills.read() {
        if k.by_player && k.team == Team::Aszendenz {
            let def = data.ship(&k.kind);
            st.kills += 1;
            st.score += if def.score == 0 { 100 } else { def.score };
            banner.write(crate::hud::HudBanner(format!("{} ZERSTÖRT", def.name.to_uppercase())));
        }
    }
}

type ShipView = (Entity, &'static Transform, &'static Ship, Has<Dying>);

fn alive_pos(ships: &Query<ShipView>, e: Option<Entity>) -> Option<Vec3> {
    let (_, tf, _, dying) = ships.get(e?).ok()?;
    (!dying).then_some(tf.translation)
}

#[allow(clippy::too_many_arguments)]
fn update_mission(
    time: Res<Time>,
    mut st: ResMut<MissionState>,
    mut sp: Spawner,
    mut radio: Radio,
    assets: Res<MissionAssets>,
    ships: Query<ShipView>,
    mut ais: Query<&mut Ai>,
    pickups: Query<(Entity, &Transform), (With<Pickup>, Without<Ship>)>,
    obstacles: Query<(&Transform, &Obstacle), Without<Ship>>,
) {
    // same step as the flight model (web: dt capped at 0.05), so timers and ships agree on slow frames
    let dt = time.delta_secs().min(MAX_DT);
    if st.ended || st.outcome.is_some() {
        return;
    }
    st.time += dt;
    let st = &mut *st;

    if st.phase == Phase::Done {
        st.end_t -= dt;
        if st.end_t <= 0.0 {
            st.outcome = Some((true, "Alle Missionsziele erfüllt.".into(), false));
        }
        return;
    }

    // ---- player down? ----
    let player_pos = alive_pos(&ships, st.player);
    let player_fwd = st.player.and_then(|e| ships.get(e).ok()).map_or(Vec3::Z, |(_, tf, _, _)| tf.rotation * Vec3::Z);

    // a failed objective wins over a later death (the story branch follows it)
    if st.fail.is_none() {
        if let Some(pe) = st.protect {
            if alive_pos(&ships, Some(pe)).is_none() {
                let name = ships.get(pe).map(|(_, _, s, _)| s.name.clone()).unwrap_or_else(|_| "Schutzobjekt".into());
                let art = if name.starts_with("Habitat") || name.starts_with("Relais") { "Das" } else { "Die" };
                fail(st, &mut radio, format!("{art} {name} wurde zerstört."));
            }
        }
    }
    if st.fail.is_some() {
        st.fail_t -= dt;
        if st.fail_t <= 0.0 {
            st.outcome = Some((false, st.fail.clone().unwrap_or_default(), false));
        }
        return;
    }
    let Some(ppos) = player_pos else {
        let t = st.dead_t.get_or_insert(3.0);
        *t -= dt;
        if *t <= 0.0 {
            st.outcome = Some((false, "Dein Jäger wurde zerstört. Du konntest dich mit der Rettungskapsel retten.".into(), true));
        }
        return;
    };
    let near = |p: Vec3, r: f32| ppos.distance_squared(p) < r * r;

    // ---- return to the carrier ----
    if st.phase == Phase::Return {
        let Some(cpos) = alive_pos(&ships, st.carrier) else {
            fail(st, &mut radio, "Die TUS Aurora wurde zerstört.".into());
            return;
        };
        // with the hangar, clearance, capture and landing are `bay_seq`'s; without it (web: !useBay) a pass
        // close to the carrier ends the mission
        if !st.use_bay && near(cpos, 750.0) {
            land(st, &mut radio);
        }
        return;
    }

    let navs = st.navs.clone();
    let Some(nav) = navs.get(st.nav_idx) else {
        // no navs at all: straight back home
        st.phase = Phase::Return;
        return;
    };
    let center = if nav.anchor { alive_pos(&ships, st.protect).unwrap_or(nav.pos) } else { nav.pos };

    // a time limit driven by an enemy capital (e.g. the gate station) stops when it is gone
    let hostile_cap = ships.iter().any(|(_, _, s, d)| !d && s.team == Team::Aszendenz && s.capital());
    if st.phase == Phase::Fight && !st.cap_seen {
        st.cap_seen = hostile_cap;
    }
    if st.timer.is_some() && nav.limit.is_some() && nav.kind == NavKind::Clear && st.phase == Phase::Fight && st.cap_seen && !hostile_cap {
        st.timer = None;
    }
    if let Some(t) = st.timer.as_mut() {
        *t -= dt;
        if *t <= 0.0 {
            st.timer = Some(0.0);
            let reason = nav.timer_fail.clone().or(nav.limit_fail.clone()).unwrap_or_else(|| "Die Zeit ist abgelaufen.".into());
            fail(st, &mut radio, reason);
            return;
        }
    }

    // ---- travel ----
    if st.phase == Phase::Travel {
        if nav.kind == NavKind::Escape {
            if near(nav.pos, 650.0) {
                radio.script(&nav.on_arrive, &sp.flags);
                complete_nav(st, &mut sp, &mut radio, &ships, &pickups, Some(ppos), player_fwd);
            }
            return;
        }
        if near(center, NAV_ARRIVE) {
            st.phase = Phase::Fight;
            st.wave = 0;
            st.wave_t = None;
            st.prog = 0.0;
            st.docking = false;
            st.cap_seen = false;
            if let Some(l) = nav.limit {
                st.timer = Some(l);
            }
            match nav.kind {
                NavKind::Survive => st.surv = nav.survive,
                NavKind::Pickup => {
                    let solid: Vec<(Vec3, f32)> = obstacles
                        .iter()
                        .map(|(tf, o)| (tf.translation, o.radius))
                        .chain(ships.iter().filter(|(_, _, s, d)| !d && s.capital()).map(|(_, tf, s, _)| (tf.translation, s.radius())))
                        .collect();
                    st.pickups_total = spawn_pickups(&mut sp.commands, &assets, &mut sp.rng, nav, &solid);
                    st.pickups_got = 0;
                }
                NavKind::Convoy => {
                    let cpos = alive_pos(&ships, st.carrier).unwrap_or(Vec3::ZERO);
                    let to = nav.convoy_to.unwrap_or(cpos + Vec3::new(0.0, -40.0, 450.0));
                    st.convoy_follow = nav.convoy_to.is_none();
                    st.convoy.clear();
                    for (i, kind) in nav.convoy_types.iter().enumerate() {
                        let pos = nav.pos + Vec3::new(i as f32 * 90.0 - 45.0, i as f32 * 20.0, i as f32 * 60.0);
                        let def = sp.data.ship(kind).clone();
                        let ai = Ai { dest: Some(to), ..default() };
                        let e = spawn_ai_ship(&mut sp, kind, pos, to - nav.pos, ai, Some(format!("{} {}", def.name, i + 1)), Some(0.0));
                        sp.commands.entity(e).insert(Cruise(nav.convoy_speed.unwrap_or(def.speed)));
                        st.convoy.push(e);
                    }
                    st.convoy_alive = st.convoy.len();
                }
                NavKind::Intercept => {
                    let to = nav.intercept_to;
                    let fast = nav.intercept_fast_if_not.as_ref().is_some_and(|f| !sp.flags.0.contains(f));
                    let ai = Ai { dest: Some(to), ..default() };
                    let e = spawn_ai_ship(&mut sp, "kurier", nav.pos, to - nav.pos, ai, Some("Kurierschiff".into()), None);
                    sp.commands.entity(e).insert(Cruise(if fast { 175.0 } else { 140.0 }));
                    st.courier = Some((e, to));
                }
                NavKind::Dock => {
                    st.prison = Some(spawn_ai_ship(&mut sp, "prison", nav.pos, Vec3::new(0.2, 0.0, 1.0), Ai::default(), Some(nav.name.clone()), None));
                }
                _ => {}
            }
            radio.log(|| format!("arrived at nav {} '{}'", st.nav_idx, nav.name));
            spawn_wave(&mut sp, &mut radio, nav, 0, center, Some(ppos), false);
            radio.script(&nav.on_arrive, &sp.flags);
        }
        return;
    }

    // ---- fight ----
    let courier = st.courier.map(|c| c.0);
    let hostiles = ships.iter().filter(|(e, _, s, d)| !d && s.team == Team::Aszendenz && Some(*e) != courier).count();
    let last_wave = st.wave + 1 >= nav.waves.len();
    let cycle = matches!(nav.kind, NavKind::Survive | NavKind::Convoy);
    if hostiles == 0 && (!last_wave || cycle) && !nav.waves.is_empty() {
        let t = st.wave_t.get_or_insert(3.0);
        *t -= dt;
        if *t <= 0.0 {
            st.wave_t = None;
            st.wave += 1;
            let idx = if cycle { st.wave % nav.waves.len() } else { st.wave };
            spawn_wave(&mut sp, &mut radio, nav, idx, center, Some(ppos), cycle && st.wave >= nav.waves.len());
        }
    }
    let done = match nav.kind {
        NavKind::Scan => {
            if near(nav.pos, 700.0) {
                st.prog += dt;
            }
            st.prog >= nav.scan
        }
        NavKind::Pickup => {
            for (e, tf) in &pickups {
                if near(tf.translation, 45.0) {
                    sp.commands.entity(e).try_despawn();
                    st.pickups_got += 1;
                    radio.sfx.write(SfxMsg::Beep);
                    radio.warp.write(WarpFlashMsg { pos: tf.translation, size: 40.0 });
                    radio.banner(&format!("{} {}/{} GEBORGEN", nav.pickup_label, st.pickups_got, st.pickups_total));
                    radio.log(|| format!("pickup {}/{}", st.pickups_got, st.pickups_total));
                }
            }
            st.pickups_got >= st.pickups_total
        }
        NavKind::Intercept => {
            let Some((ce, to)) = st.courier else { return };
            match alive_pos(&ships, Some(ce)) {
                Some(cp) if cp.distance(to) < 300.0 => {
                    sp.commands.entity(ce).try_despawn();
                    radio.warp.write(WarpFlashMsg { pos: cp, size: 160.0 });
                    radio.sfx.write(SfxMsg::Warp);
                    fail(st, &mut radio, "Das Kurierschiff hat den Sprungpunkt erreicht.".into());
                    return;
                }
                Some(_) => false,
                None => true,
            }
        }
        NavKind::Convoy => {
            let alive: usize = st.convoy.iter().filter(|e| alive_pos(&ships, Some(**e)).is_some()).count();
            if alive == 0 {
                fail(st, &mut radio, nav.fail_text.clone().unwrap_or_else(|| "Der Konvoi wurde vernichtet.".into()));
                return;
            }
            if alive < st.convoy_alive {
                radio.banner("KONVOISCHIFF VERLOREN");
                radio.sfx.write(SfxMsg::Beep);
            }
            st.convoy_alive = alive;
            let follow = if st.convoy_follow { alive_pos(&ships, st.carrier).map(|c| c + Vec3::new(0.0, -40.0, 450.0)) } else { None };
            let mut all_there = true;
            for &e in &st.convoy {
                let Some(p) = alive_pos(&ships, Some(e)) else { continue };
                if let Ok(mut ai) = ais.get_mut(e) {
                    if let Some(f) = follow {
                        ai.dest = Some(f);
                    }
                    if ai.dest.is_some_and(|d| p.distance(d) >= 300.0) {
                        all_there = false;
                    }
                }
            }
            all_there
        }
        NavKind::Survive => {
            st.surv -= dt;
            st.surv <= 0.0
        }
        NavKind::Dock => {
            if !st.docking && last_wave && hostiles == 0 {
                st.docking = true;
                st.prog = 0.0;
                radio.script(&nav.on_dock, &sp.flags);
                radio.banner("ANDOCKEN FREIGEGEBEN");
            }
            if st.docking {
                if let Some(pp) = alive_pos(&ships, st.prison) {
                    if near(pp, 170.0) {
                        if !st.dock_wave && !nav.dock_wave.is_empty() {
                            st.dock_wave = true;
                            spawn_group(&mut sp, &mut radio, &nav.dock_wave, pp + Vec3::new(1400.0, 300.0, 0.0), pp);
                        }
                        st.prog += dt;
                    }
                }
            }
            st.docking && st.prog >= nav.dock
        }
        NavKind::Clear | NavKind::Escape => last_wave && hostiles == 0,
    };
    if done {
        complete_nav(st, &mut sp, &mut radio, &ships, &pickups, Some(ppos), player_fwd);
    }
}

fn fail(st: &mut MissionState, radio: &mut Radio, reason: String) {
    if st.fail.is_some() {
        return;
    }
    radio.log(|| format!("FAIL: {reason}"));
    st.fail = Some(reason);
    st.fail_t = 3.0;
    radio.banner("MISSION GESCHEITERT");
    radio.sfx.write(SfxMsg::Beep);
}

fn land(st: &mut MissionState, radio: &mut Radio) {
    st.phase = Phase::Done;
    st.end_t = 3.0;
    radio.say("flug", "Landung bestätigt. Willkommen zu Hause, {cs}.");
    radio.banner("LANDUNG BESTÄTIGT");
    radio.log(|| "landed".into());
}

/// Web completeNav(): radio lines, objective navs make the remaining enemies retreat, next nav / return / done.
fn complete_nav(
    st: &mut MissionState,
    sp: &mut Spawner,
    radio: &mut Radio,
    ships: &Query<ShipView>,
    pickups: &Query<(Entity, &Transform), (With<Pickup>, Without<Ship>)>,
    ppos: Option<Vec3>,
    pfwd: Vec3,
) {
    let navs = st.navs.clone();
    let Some(nav) = navs.get(st.nav_idx) else { return };
    radio.script(&nav.on_clear, &sp.flags);
    let last = st.nav_idx + 1 >= st.navs.len();
    if nav.kind != NavKind::Clear || (last && st.no_return) {
        for (e, tf, s, d) in ships.iter() {
            if !d && s.team == Team::Aszendenz {
                sp.commands.entity(e).try_despawn();
                radio.warp.write(WarpFlashMsg { pos: tf.translation, size: if s.capital() { 400.0 } else { 120.0 } });
            }
        }
    }
    // seekers and fusion torpedoes still in flight must not undo an objective that is already met
    radio.cancel_seekers.write(CancelSeekersMsg(Team::Aszendenz));
    for (e, _) in pickups.iter() {
        sp.commands.entity(e).try_despawn();
    }
    st.courier = None;
    st.prison = None;
    st.convoy.clear();
    st.timer = None;
    st.docking = false;
    st.dock_wave = false;
    st.prog = 0.0;
    st.cap_seen = false;
    st.nav_idx += 1;
    if st.nav_idx < st.navs.len() {
        st.phase = Phase::Travel;
        radio.banner("SEKTOR GESICHERT");
        activate_nav(st, sp, radio, ppos, pfwd);
    } else if st.no_return {
        st.phase = Phase::Done;
        let talk: f32 = nav.on_clear.iter().filter(|l| passes(l, &sp.flags)).map(|l| 2.4 + l.text.chars().count() as f32 * 0.045).sum();
        st.end_t = (talk + 1.5).max(4.0);
        radio.banner("MISSIONSZIELE ERFÜLLT");
        radio.log(|| "all navs done (no return)".into());
    } else {
        st.phase = Phase::Return;
        radio.banner("MISSIONSZIELE ERFÜLLT");
        radio.log(|| "all navs done, return to the carrier".into());
    }
    radio.sfx.write(SfxMsg::Beep);
}

/// Aces (Archon Veyl) escape when badly hit, except in the final battle (web damage()).
/// The shot-down wingman's jump-out is weapons.rs' business: here he only leaves the formation (no failure).
fn jump_outs(
    mut commands: Commands,
    mut st: ResMut<MissionState>,
    ships: Query<(Entity, &Transform, &Ship), Without<Dying>>,
    left: Query<Has<JumpedOut>>,
    mut radio: Radio,
) {
    // gone (despawned after the jump) or marked: the wingman has left the fight
    if let Some(w) = st.wingman.filter(|w| left.get(*w).unwrap_or(true)) {
        st.wingman = None;
        radio.log(|| format!("wingman {w} jumped out"));
    }
    let final_nav = st.navs.get(st.nav_idx).is_some_and(|n| n.is_final);
    for (e, tf, s) in &ships {
        if s.def.ace && s.hp < s.max_hp * 0.4 && !final_nav && s.team == Team::Aszendenz {
            commands.entity(e).try_despawn();
            radio.warp.write(WarpFlashMsg { pos: tf.translation, size: 120.0 });
            radio.sfx.write(SfxMsg::Warp);
            radio.log(|| format!("{} jumps out", s.name));
        }
    }
}

/// After the win nothing may kill the player any more.
fn keep_alive_after_win(st: Res<MissionState>, mut q: Query<&mut Ship, (With<Player>, Without<Dying>)>) {
    if st.phase != Phase::Done {
        return;
    }
    for mut s in &mut q {
        s.hp = s.hp.max(1.0);
        s.shield = s.max_shield;
    }
}

/// Mines hit by weapons fire this frame.
#[derive(Resource, Default)]
struct ShotMines(Vec<Entity>);

/// weapons.rs stops bolts at obstacles and reports the impact as a hit effect without a ship
/// (`Entity::PLACEHOLDER`): an impact on a mine sets it off.
fn mine_hits(mut hits: MessageReader<HitFxMsg>, mines: Query<(Entity, &Transform), With<Mine>>, mut shot: ResMut<ShotMines>) {
    for h in hits.read() {
        if h.ship != Entity::PLACEHOLDER {
            continue;
        }
        if let Some((e, _)) = mines.iter().find(|(_, tf)| tf.translation.distance_squared(h.pos) < 7.0 * 7.0) {
            shot.0.push(e);
        }
    }
}

/// Mines home in on Union ships within 170 m and explode within 20 m (75 m blast). Shooting one sets it off.
#[allow(clippy::too_many_arguments)]
fn update_mines(
    time: Res<Time>,
    mut commands: Commands,
    mut mines: Query<(Entity, &mut Transform, &mut Mine), Without<Ship>>,
    ships: Query<(Entity, &Transform, &Ship, &Hittable), Without<Dying>>,
    mut shot: ResMut<ShotMines>,
    mut dmg: MessageWriter<DamageMsg>,
    mut boom: MessageWriter<ExplodeMsg>,
    mut sfx: MessageWriter<SfxMsg>,
    mut fired: Local<Vec<(Entity, Vec3)>>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    fired.clear();
    for e in shot.0.drain(..) {
        if let Ok((e, tf, _)) = mines.get(e) {
            if !fired.iter().any(|f| f.0 == e) {
                fired.push((e, tf.translation));
            }
        }
    }
    for (e, mut tf, mut mine) in &mut mines {
        if fired.iter().any(|f| f.0 == e) {
            continue;
        }
        let mut best: Option<(Vec3, f32, bool)> = None;
        for (_, stf, s, hit) in &ships {
            if s.team != Team::Union || s.def.ghost {
                continue;
            }
            let d = if s.capital() { box_dist(stf, hit, tf.translation) } else { stf.translation.distance(tf.translation) };
            if d < 170.0 && best.is_none_or(|b| d < b.1) {
                best = Some((stf.translation, d, s.capital()));
            }
        }
        mine.active = best.is_some();
        tf.rotate_y(dt * 0.4);
        let Some((target, d, cap)) = best else { continue };
        if d < if cap { 18.0 } else { 20.0 } {
            fired.push((e, tf.translation));
            continue;
        }
        let step = (target - tf.translation).normalize_or_zero() * 38.0 * dt;
        tf.translation += step;
    }
    for &(e, pos) in fired.iter() {
        commands.entity(e).try_despawn();
        boom.write(ExplodeMsg { pos, size: 1.1 });
        sfx.write(SfxMsg::Explosion { size: 1.1 });
        for (se, stf, s, hit) in &ships {
            if s.def.ghost {
                continue;
            }
            let d = if s.capital() { box_dist(stf, hit, pos).max(0.0) } else { stf.translation.distance(pos) };
            if d < 75.0 {
                dmg.write(DamageMsg { target: se, amount: (if s.capital() { 90.0 } else { 55.0 }) * (1.0 - d / 75.0) + 10.0, source: None, point: pos });
            }
        }
    }
}

/// Distance from a point to a capital ship's hull box (sphere if it has none).
fn box_dist(tf: &Transform, hit: &Hittable, p: Vec3) -> f32 {
    match hit.half_extents {
        Some(h) => {
            let l = tf.rotation.inverse() * (p - tf.translation);
            let q = l.abs() - h;
            q.max(Vec3::ZERO).length() + q.max_element().min(0.0)
        }
        None => tf.translation.distance(p) - hit.radius,
    }
}

fn blink_mines(time: Res<Time>, mines: Query<&Mine>, mut glows: Query<(&mut Transform, &ChildOf), (With<MineGlow>, Without<Mine>)>) {
    let t = time.elapsed_secs();
    for (mut tf, parent) in &mut glows {
        let Ok(m) = mines.get(parent.parent()) else { continue };
        let rate = if m.active { 10.0 } else { 2.0 };
        let on = (t * rate + m.phase).sin() > 0.2;
        tf.scale = Vec3::splat(if on { 14.0 } else { 6.0 });
    }
}

fn spin_pickups(time: Res<Time>, mut q: Query<&mut Transform, (With<Pickup>, Without<Ship>)>) {
    let dt = time.delta_secs();
    for mut tf in &mut q {
        tf.rotate_y(dt * 2.0);
    }
}

/// Camera-facing quad (glows): its world rotation is replaced by the camera's after transform propagation.
#[derive(Component)]
struct Billboard;

fn face_camera(cam: Query<&GlobalTransform, With<MainCamera>>, mut q: Query<&mut GlobalTransform, (With<Billboard>, Without<MainCamera>)>) {
    let Ok(cam) = cam.single() else { return };
    let rot = cam.rotation();
    for mut gt in &mut q {
        let (s, _, p) = gt.to_scale_rotation_translation();
        *gt = GlobalTransform::from(Transform { translation: p, rotation: rot, scale: s });
    }
}

/// Pooled blue jump flashes (jump-ins of enemy waves, retreats, pickups).
fn warp_fx(
    time: Res<Time>,
    mut msgs: MessageReader<WarpFlashMsg>,
    mut pool: Query<(&mut WarpFlash, &mut Transform, &mut Visibility)>,
    mut mats: ResMut<Assets<StandardMaterial>>,
) {
    for m in msgs.read() {
        // a free slot, else the oldest flash
        let age = |f: &WarpFlash| if f.t <= 0.0 { f32::INFINITY } else { f.life - f.t };
        let Some((mut fl, mut tf, mut vis)) = pool.iter_mut().max_by(|a, b| age(&a.0).total_cmp(&age(&b.0))) else { continue };
        fl.t = fl.life;
        fl.size = m.size * 1.4;
        tf.translation = m.pos;
        tf.scale = Vec3::splat(fl.size * 0.3);
        *vis = Visibility::Visible;
    }
    let dt = time.delta_secs();
    for (mut fl, mut tf, mut vis) in &mut pool {
        if fl.t <= 0.0 {
            continue;
        }
        fl.t -= dt;
        let k = (fl.t / fl.life).clamp(0.0, 1.0);
        tf.scale = Vec3::splat(fl.size * (0.3 + (1.0 - k) * 0.7));
        if let Some(mut m) = mats.get_mut(&fl.material) {
            let b = k * k * 2.5;
            m.base_color = Color::LinearRgba(LinearRgba::rgb(1.6 * b, 2.6 * b, 4.5 * b));
        }
        if fl.t <= 0.0 {
            *vis = Visibility::Hidden;
        }
    }
}

// ---------- launch from and landing in the carrier's hangar ----------

/// Everything the hangar sequences change besides the ships.
#[derive(SystemParam)]
struct BayIo<'w> {
    lib: Res<'w, ShipLibrary>,
    mats: ResMut<'w, Assets<StandardMaterial>>,
    settings: ResMut<'w, Settings>,
    shake: ResMut<'w, CameraShake>,
    beep: MessageWriter<'w, BeepMsg>,
    damage: MessageWriter<'w, DamageMsg>,
    status: ResMut<'w, BayStatus>,
}

impl BayIo<'_> {
    /// web setBayLights + setBayField + setClamps
    fn lights(&mut self, lamps: (bool, bool, bool), field: f32, clamps: bool) {
        let bay = &self.lib.bay;
        bay.set_lamps(&mut self.mats, lamps.0, lamps.1, lamps.2);
        bay.set_field(&mut self.mats, field);
        bay.set_clamps(&mut self.mats, clamps);
    }
    fn beep(&mut self, freq: f32, vol: f32) {
        self.beep.write(BeepMsg { freq, vol });
    }
}

type BayShips<'w, 's> = Query<
    'w,
    's,
    (Entity, &'static mut Transform, &'static mut Ship, Option<&'static mut Player>, Option<&'static mut Neutron>, Has<Dying>, Option<&'static Ai>),
>;

/// carrier-local point -> world (the carrier keeps moving during both sequences)
fn bay_to_world(c: &Transform, l: Vec3) -> Vec3 {
    c.translation + c.rotation * l
}

fn bay_local(c: &Transform, p: Vec3) -> Vec3 {
    c.rotation.inverse() * (p - c.translation)
}

/// Parking spots are handed out by arrival: the first ship in takes the deepest, so nobody flies through a
/// parked ship (web nextBayStop).
fn next_bay_stop(pilots: &[BayPilot], me: usize) -> f32 {
    let taken: Vec<f32> = pilots.iter().enumerate().filter(|(i, p)| *i != me && p.held && p.stop.is_some()).filter_map(|(_, p)| p.stop).collect();
    let mut k = 0;
    loop {
        let z = BAY.back + 18.0 + k as f32 * 36.0;
        if !taken.iter().any(|t| (t - z).abs() < 0.5) || z > BAY.mouth - 40.0 {
            return z.min(BAY.mouth - 40.0);
        }
        k += 1;
    }
}

/// Put a pilot on the landing autopilot (web startLanding, per pilot): waypoints in carrier space swing wide
/// round the hull if needed, then line up ahead of the bow. `i` staggers the approach points.
fn start_landing_pilot(pilots: &mut [BayPilot], idx: usize, i: usize, c: &Transform, tf: &Transform, commands: &mut Commands) {
    let l = bay_local(c, tf.translation);
    let f = c.rotation.inverse() * fwd(tf);
    let p = &mut pilots[idx];
    p.held = true;
    p.stop = None;
    commands.entity(p.e).try_insert(SeqHold { launch: false });
    // already lined up in front of the opening and pointing in: straight to the final approach
    if in_bay_corridor(l, 250.0) && f.z < 0.0 {
        p.wps.clear();
        p.stage = Some(LandStage::Final);
        let stop = next_bay_stop(pilots, idx);
        pilots[idx].stop = Some(stop);
        return;
    }
    let a = Vec3::new(0.0, BAY.y - 0.5, BAY.mouth + 480.0 + i as f32 * 60.0);
    let sx = if l.x < 0.0 { -1.0 } else { 1.0 };
    p.wps = if l.z > BAY.mouth + 250.0 && l.x.abs() < 400.0 { vec![a] } else { vec![Vec3::new(sx * (320.0 + i as f32 * 40.0), -90.0, 200.0), a] };
    p.stage = Some(LandStage::Approach);
}

/// web cancelLances(): a charge cut off by the autopilot or the tractor beam goes back into the capacitors
fn cancel_lance(ship: &mut Ship, neutron: Option<Mut<Neutron>>) {
    if let Some(mut n) = neutron
        && n.charge.take().is_some()
    {
        n.target = None;
        ship.missiles += 1;
    }
}

/// Launch and landing sequences (web updateSeq, startLanding, captureInBay and the return-phase part of
/// updateMission): runs after the ships moved and moves the ships on rails relative to the moving carrier.
#[allow(clippy::too_many_arguments)]
fn bay_seq(
    time: Res<Time>,
    mut commands: Commands,
    mut st: ResMut<MissionState>,
    mut radio: Radio,
    mut io: BayIo,
    mut ships: BayShips,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let ctf = st.carrier.and_then(|c| ships.get(c).ok()).filter(|c| !c.5).map(|c| *c.1);
    // the carrier's cruise speed: launched ships keep its motion
    let c_spd = st.carrier.and_then(|c| ships.get(c).ok()).map_or(0.0, |s| s.2.speed);
    io.status.carrier = ctf;
    if !st.use_bay || st.ended {
        return;
    }
    let st = &mut *st;
    let mut pilots = std::mem::take(&mut st.bay);
    // the wingman counts while he flies (gone: jumped out or destroyed)
    let alive = |p: &BayPilot, ships: &BayShips, wingman: Option<Entity>| (p.player || wingman == Some(p.e)) && ships.get(p.e).is_ok_and(|s| !s.5);

    if let Some(c) = ctf {
        // ---- launch (web updateSeq, kind 'launch') ----
        if let Some(seq) = st.seq.as_mut().filter(|q| q.kind == SeqKind::Launch) {
            seq.t = (seq.t + dt).min(radio.test.bay_freeze.unwrap_or(f32::INFINITY));
            let t = seq.t;
            // red: engines pre-heat · amber: clamps release, the ship floats free, the bay field drops · green: own thrust
            if seq.light == 0 && t > 1.2 {
                seq.light = 1;
                io.lights((false, true, false), 1.0, false);
                radio.sfx.write(SfxMsg::ShieldHit);
                io.beep(700.0, 0.16);
            }
            if seq.light == 1 && t > LAUNCH_GO {
                seq.light = 2;
                io.lights((false, false, true), 0.0, false);
                io.beep(1300.0, 0.2);
                // green: the pilot flies out alone - low thrust, steering inside the tube is up to them
                for p in pilots.iter_mut().filter(|p| p.player) {
                    if let Ok((e, _, mut ship, Some(mut pl), _, false, _)) = ships.get_mut(p.e) {
                        p.held = false;
                        p.in_bay = true;
                        commands.entity(e).try_remove::<SeqHold>();
                        ship.speed = c_spd + 25.0;
                        pl.throttle = 0.25;
                    }
                }
                radio.say("flug", "Startfreigabe! Schub geben und raus aus der Bucht, {cs}.");
            }
            if seq.light >= 1 {
                io.lights((false, seq.light == 1, seq.light == 2), (1.0 - (t - 1.2) / 1.0).max(0.0), false);
            }
            let light = seq.light;
            // where the player is in the tube (the wingman stays behind him)
            let player_z = pilots.iter().find(|p| p.player && !p.out).and_then(|p| ships.get(p.e).ok().filter(|s| !s.5)).map(|s| bay_local(&c, s.1.translation).z);
            let mut out = 0;
            for p in pilots.iter_mut() {
                let Ok((e, mut tf, mut ship, _, _, dying, _)) = ships.get_mut(p.e) else {
                    p.out = true;
                    out += 1;
                    continue;
                };
                let l = bay_local(&c, tf.translation);
                if !p.held {
                    if p.player && !p.out && (p.frozen.is_some() || radio.test.out_freeze.is_some_and(|z| l.z >= z)) {
                        // SF_OUT_FREEZE: hold the launched ship where it is (screenshots)
                        let (fl, fr) = *p.frozen.get_or_insert((l, c.rotation.inverse() * tf.rotation));
                        tf.translation = bay_to_world(&c, fl);
                        tf.rotation = c.rotation * fr;
                        continue;
                    }
                    if p.out || dying || l.z > BAY.mouth + 30.0 || t > 30.0 || !in_bay_corridor(l, 40.0) {
                        if p.in_bay {
                            p.in_bay = false;
                            if let Some(v) = st.view_saved.take()
                                && v != io.settings.view
                            {
                                io.settings.view = v;
                            }
                        }
                        p.out = true;
                        out += 1;
                    }
                    continue;
                }
                // after the clamps let go the ship lifts a little and hovers on its thrusters
                let lift = if t > 1.2 { ((t - 1.2) / 0.8).min(1.0) * 1.4 + (t * 3.0).sin() * 0.12 } else { 0.0 };
                if p.player {
                    io.shake.bump(0.04 + t * 0.02); // engines spooling up
                }
                if !p.player && light == 2 {
                    // the wingman follows the player out of the tube, never closer than 40 m behind him
                    let z0 = p.launch_z;
                    p.v = (p.v + 45.0 * dt).min(130.0);
                    let mut z = z0 + p.v * dt;
                    if let Some(pz) = player_z {
                        z = z.min(pz - 40.0).max(z0);
                    }
                    p.launch_z = z;
                    let y = BAY.y - 0.5 + if z < BAY.mouth { 1.4 } else { 1.4 * (1.0 - (z - BAY.mouth) / 60.0).max(0.0) };
                    tf.translation = bay_to_world(&c, Vec3::new(0.0, y, z));
                    tf.rotation = c.rotation;
                    ship.speed = 0.0;
                    ship.bank *= 1.0 - (dt * 6.0).min(1.0);
                    if z > BAY.mouth + 120.0 {
                        // clear of the bow: the wingman flies on his own again
                        p.held = false;
                        p.out = true;
                        out += 1;
                        ship.speed = c_spd + p.v;
                        commands.entity(e).try_remove::<SeqHold>();
                    }
                    continue;
                }
                tf.translation = bay_to_world(&c, Vec3::new(0.0, BAY.y - 0.5 + lift, p.launch_z));
                tf.rotation = c.rotation;
                ship.speed = 0.0;
            }
            if out == pilots.len() {
                st.seq = None;
                io.lights((false, false, false), 1.0, true);
                if pilots.len() > 1 {
                    radio.say("flug", "Beide Jäger frei. Schleusenfeld wieder aktiv. Gute Jagd, {cs}!");
                } else {
                    radio.say("flug", "Jäger frei, Schleusenfeld wieder aktiv. Gute Jagd, {cs}!");
                }
                radio.log(|| "launch complete".into());
                if radio.test.test_return && st.phase == Phase::Travel {
                    // SF_TEST_RETURN: every nav point done, straight home
                    st.nav_idx = st.navs.len();
                    st.phase = Phase::Return;
                    st.timer = None;
                    radio.log(|| "TEST: skipping to the return flight".into());
                }
            }
        }

        // ---- return: landing clearance, tractor beam, landing autopilot (web updateMission / startLanding) ----
        let landing_open = st.phase == Phase::Return && st.fail.is_none() && st.outcome.is_none();
        let player_pilot = pilots.iter().position(|p| p.player);
        if landing_open && !st.land_clear {
            let ppos = player_pilot.and_then(|i| ships.get(pilots[i].e).ok().filter(|s| !s.5)).map(|s| s.1.translation);
            if ppos.is_some_and(|p| p.distance(c.translation) < 1800.0) {
                let threat = ships.iter().any(|(_, tf, s, _, _, d, _)| !d && s.team == Team::Aszendenz && !s.capital() && tf.translation.distance(c.translation) < 3500.0);
                if !threat {
                    st.land_clear = true;
                    io.lights((false, false, true), 0.0, false);
                    radio.say("flug", "Landefreigabe Bucht eins, {cs}. Folgen Sie dem Leitstrahl unter den Bug und fliegen Sie selbst ein – unter 120 Metern pro Sekunde. Oder AUTO für den Landeautopiloten.");
                    radio.banner("LANDEFREIGABE · BUCHT 1");
                    io.beep(900.0, 0.18);
                    radio.log(|| "landing clearance".into());
                    // the wingman goes in first (he takes the deepest stop mark, out of the player's way)
                    if let Some(wi) = pilots.iter().position(|p| !p.player && !p.held && alive(p, &ships, st.wingman))
                        && let Ok((_, wtf, ..)) = ships.get(pilots[wi].e)
                    {
                        let wtf = *wtf;
                        start_landing_pilot(&mut pilots, wi, 1, &c, &wtf, &mut commands);
                        st.seq.get_or_insert(Seq { kind: SeqKind::Land, t: 0.0, light: 0, done_t: None });
                        if let Some(who) = ships.get(pilots[wi].e).ok().and_then(|s| s.6?.who.clone()) {
                            radio.say(&who, "Verstanden. Ich gehe zuerst rein, {cs} – wir sehen uns an Bord.");
                        }
                    }
                } else if !st.land_warned {
                    st.land_warned = true;
                    radio.say("flug", "Negativ, {cs} – Feindkontakt am Träger. Erst den Sektor säubern, dann Landefreigabe.");
                }
            }
        }
        if landing_open && st.land_clear {
            if let Some(pi) = player_pilot.filter(|&i| !pilots[i].held && alive(&pilots[i], &ships, st.wingman)) {
                let pe = pilots[pi].e;
                if std::mem::take(&mut st.want_landing) {
                    // landing autopilot (web startLanding)
                    if let Ok((_, tf, mut ship, pl, neutron, _, _)) = ships.get_mut(pe) {
                        let tf = *tf;
                        cancel_lance(&mut ship, neutron);
                        if let Some(mut pl) = pl {
                            pl.boosting = false;
                        }
                        start_landing_pilot(&mut pilots, pi, 0, &c, &tf, &mut commands);
                    }
                    st.seq.get_or_insert(Seq { kind: SeqKind::Land, t: 0.0, light: 0, done_t: None });
                    io.lights((false, false, true), 0.0, false);
                    radio.say("flug", "Verstanden, {cs}. Landeautopilot übernimmt.");
                    radio.banner("LANDEAUTOPILOT");
                    io.beep(900.0, 0.18);
                    radio.log(|| "landing autopilot".into());
                } else if let Ok((_, mut tf, mut ship, pl, neutron, _, _)) = ships.get_mut(pe) {
                    // flown into the open bay by hand: the tractor beam catches the ship (web captureInBay),
                    // incl. a ship resting on the back wall
                    let l = bay_local(&c, tf.translation);
                    let p = &mut pilots[pi];
                    let inward = (c.rotation.inverse() * fwd(&tf)).z < 0.0;
                    if p.frozen.is_some() || radio.test.land_freeze.is_some_and(|z| inward && l.z <= z) {
                        // SF_LAND_FREEZE: hold the hand-flown ship where it is (screenshots of the approach aids)
                        let (fl, fr) = *p.frozen.get_or_insert((l, c.rotation.inverse() * tf.rotation));
                        tf.translation = bay_to_world(&c, fl);
                        tf.rotation = c.rotation * fr;
                    } else if in_bay_corridor(l, 0.0) && l.z < BAY.mouth - 8.0 && l.z > BAY.back + 5.0 {
                        cancel_lance(&mut ship, neutron);
                        if let Some(mut pl) = pl {
                            pl.boosting = false;
                        }
                        let fast = ship.speed > 150.0;
                        let p = &mut pilots[pi];
                        p.held = true;
                        p.stage = Some(LandStage::Final);
                        p.wps.clear();
                        p.stop = None;
                        commands.entity(pe).try_insert(SeqHold { launch: false });
                        let stop = next_bay_stop(&pilots, pi);
                        pilots[pi].stop = Some(stop);
                        st.seq.get_or_insert(Seq { kind: SeqKind::Land, t: 0.0, light: 0, done_t: None });
                        if fast {
                            io.damage.write(DamageMsg { target: pe, amount: 18.0, source: None, point: tf.translation });
                            io.shake.bump(0.9);
                            radio.say("flug", "Viel zu schnell, {cs}! Der Traktorstrahl fängt Sie gerade noch ab.");
                        } else {
                            radio.say("flug", "Traktorstrahl erfasst. Sauberer Anflug, {cs}.");
                        }
                        io.beep(1100.0, 0.15);
                        radio.log(|| format!("tractor beam capture at {:.0} m/s", ship.speed));
                    }
                }
            }
        }
        st.want_landing = false;

        // ---- landing on rails (web updateSeq, landing part) ----
        for idx in 0..pilots.len() {
            if !pilots[idx].held || pilots[idx].stage.is_none() || !alive(&pilots[idx], &ships, st.wingman) {
                continue;
            }
            if pilots[idx].stage == Some(LandStage::Final) && pilots[idx].stop.is_none() {
                let stop = next_bay_stop(&pilots, idx);
                pilots[idx].stop = Some(stop);
            }
            let Ok((_, mut tf, mut ship, ..)) = ships.get_mut(pilots[idx].e) else { continue };
            let p = &mut pilots[idx];
            let l = bay_local(&c, tf.translation);
            let up = c.rotation * Vec3::Y;
            if p.player && p.stage == Some(LandStage::Final) && (p.frozen.is_some() || radio.test.land_freeze.is_some_and(|z| l.z <= z)) {
                // SF_LAND_FREEZE: hold the ship where it is relative to the carrier (screenshots)
                let (fl, fr) = *p.frozen.get_or_insert((l, c.rotation.inverse() * tf.rotation));
                tf.translation = bay_to_world(&c, fl);
                tf.rotation = c.rotation * fr;
                continue;
            }
            ship.bank *= 1.0 - (dt * 6.0).min(1.0);
            match p.stage {
                Some(LandStage::Approach) => {
                    // next waypoint (the last one is the approach point ahead of the bow, on the bay's centre line)
                    let Some(&a) = p.wps.first() else {
                        p.stage = Some(LandStage::Final);
                        continue;
                    };
                    let d = l.distance(a);
                    let dir = c.rotation * (a - l).normalize_or(Vec3::NEG_Z);
                    tf.rotation = tf.rotation.rotate_towards(facing(dir, up), 1.6 * dt).normalize();
                    ship.speed = (d * 0.4).clamp(90.0, 260.0);
                    let f = fwd(&tf);
                    tf.translation += f * ship.speed * dt;
                    // reached, or flown past (never circle a waypoint)
                    if d < 45.0 || (d < 220.0 && f.dot(dir) < 0.0) {
                        p.wps.remove(0);
                        if p.wps.is_empty() {
                            p.stage = Some(LandStage::Final);
                        }
                    }
                }
                Some(LandStage::Final) => {
                    let stop = p.stop.unwrap_or(BAY.back + 18.0);
                    // final approach, nose first: chase a point on the bay's centre line a little ahead, slowing towards the stop mark
                    let target = Vec3::new(0.0, BAY.y - 0.5, stop.max(l.z - 70.0));
                    let to = target - l;
                    let dz = l.z - stop;
                    let mut dir = to;
                    if to.length_squared() > 1.0 {
                        dir = c.rotation * to.normalize();
                        tf.rotation = tf.rotation.rotate_towards(facing(dir, up), 2.4 * dt).normalize();
                    }
                    let f = fwd(&tf);
                    let align = f.dot(dir);
                    let v = (18.0 + dz * 0.45).clamp(18.0, 150.0) * (0.35 + 0.65 * align.max(0.0));
                    ship.speed = v;
                    tf.translation += f * v * dt;
                    // inside the tube the guidance beam holds the ship on the centre line
                    if dz < BAY.mouth - stop + 40.0 {
                        let mut lc = bay_local(&c, tf.translation);
                        let k = (dt * 4.0).min(1.0);
                        lc.x -= lc.x * k;
                        lc.y += (BAY.y - 0.5 - lc.y) * k;
                        tf.translation = bay_to_world(&c, lc);
                        let nose_in = c.rotation * Quat::from_rotation_y(std::f32::consts::PI);
                        tf.rotation = tf.rotation.rotate_towards(nose_in, 3.0 * dt).normalize();
                    }
                    if bay_local(&c, tf.translation).z <= stop {
                        // set down: clamps on
                        p.stage = Some(LandStage::Parked);
                        p.park_rot = c.rotation.inverse() * tf.rotation;
                        radio.sfx.write(SfxMsg::ShieldHit);
                        if p.player {
                            io.shake.bump(0.3);
                        }
                        io.lib.bay.set_clamps(&mut io.mats, true);
                        radio.log(|| format!("{} parked on stop mark {stop:.0}", if p.player { "player" } else { "wingman" }));
                    }
                }
                Some(LandStage::Parked) => {
                    ship.speed = 0.0;
                    let stop = p.stop.unwrap_or(BAY.back + 18.0);
                    tf.translation = bay_to_world(&c, Vec3::new(0.0, BAY.y - 0.5, stop));
                    tf.rotation = c.rotation * p.park_rot;
                }
                None => {}
            }
        }
        // the mission ends once every pilot who is still alive is parked in the bay
        if let Some(seq) = st.seq.as_mut().filter(|q| q.kind == SeqKind::Land) {
            seq.t += dt;
            let living: Vec<&BayPilot> = pilots.iter().filter(|p| alive(p, &ships, st.wingman)).collect();
            let all = !living.is_empty() && living.iter().all(|p| p.held && p.stage == Some(LandStage::Parked)) && st.fail.is_none() && st.outcome.is_none();
            if all {
                match seq.done_t {
                    None => {
                        seq.done_t = Some(seq.t);
                        radio.banner("LANDUNG BESTÄTIGT");
                        radio.say("flug", "Aufgesetzt. Willkommen zurück an Bord, {cs}.");
                        st.engine_off = true;
                        radio.log(|| "landed".into());
                    }
                    Some(d) if seq.t - d > 2.2 && !radio.test.bay_stay => {
                        st.seq = None;
                        io.lights((false, false, false), 1.0, true);
                        st.phase = Phase::Done;
                        st.end_t = 0.0;
                    }
                    _ => {}
                }
            } else if seq.done_t.is_some() {
                seq.done_t = None;
                st.engine_off = false;
            }
        }
    }

    // ---- what the HUD, the camera rig and the sound need ----
    let me = pilots.iter().find(|p| p.player);
    io.status.launch_t = st.seq.filter(|q| q.kind == SeqKind::Launch && me.is_some_and(|p| p.held)).map(|q| q.t);
    io.status.in_bay = me.is_some_and(|p| p.in_bay);
    io.status.landing = me.filter(|p| p.held).and_then(|p| p.stage.map(|s| (s, p.stop.unwrap_or(BAY.back + 18.0))));
    io.status.land_clear = st.phase == Phase::Return && st.land_clear && ctf.is_some() && !me.is_some_and(|p| p.held);
    io.status.engine_off = st.engine_off;
    let local = match (ctf, me.and_then(|p| ships.get(p.e).ok())) {
        (Some(c), Some(s)) => Some(bay_local(&c, s.1.translation)),
        _ => None,
    };
    io.status.local = local.unwrap_or(Vec3::ZERO);
    io.status.inside = local.is_some_and(|l| in_bay_corridor(l, 0.0) && l.z < BAY.mouth);
    st.bay = pilots;
}

/// Autopilot (web autopilot()): jump to 2.3 km before the nav point, or land when cleared to.
fn autopilot(
    mut req: MessageReader<AutopilotRequest>,
    status: Res<MissionStatus>,
    mut st: ResMut<MissionState>,
    mut player: Query<(&mut Transform, &mut Ship, &mut Player, Option<&mut Neutron>), Without<Dying>>,
    mut others: Query<(&mut Transform, &mut Ship), (Without<Player>, Without<Dying>)>,
    mut radio: Radio,
    mut cut: MessageWriter<CameraCutMsg>,
) {
    let asked = req.read().count() > 0;
    if !asked && !(radio.test.autojump && status.auto_available) {
        return;
    }
    if !status.auto_available || st.outcome.is_some() {
        radio.sfx.write(SfxMsg::Beep);
        return;
    }
    let Ok((mut ptf, mut pship, mut pl, neutron)) = player.single_mut() else { return };
    let Some(np) = st.nav_target else { return };
    // web cancelLances(): a charging neutron cannon is aborted, the shot goes back into the capacitors
    if let Some(mut n) = neutron {
        if n.charge.take().is_some() {
            n.target = None;
            pship.missiles += 1;
        }
    }
    if st.phase == Phase::Return && st.land_clear {
        // landing autopilot (web startLanding): `bay_seq` takes over
        st.want_landing = true;
        return;
    }
    let lp = ptf.translation;
    let back = (lp - np).normalize_or(Vec3::NEG_Z);
    radio.sfx.write(SfxMsg::Warp);
    cut.write(CameraCutMsg);
    pl.impulse = false;
    pl.impulse_prog = 0.0;
    pl.boosting = false;
    let rot = facing(-back, Vec3::Y);
    let base = np + back * radio.test.jump_dist.unwrap_or(2300.0);
    ptf.translation = base;
    ptf.rotation = rot;
    pship.speed = pship.speed.min(pship.def.boost.unwrap_or(pship.def.speed));
    if let Some((mut wtf, mut wship)) = st.wingman.and_then(|w| others.get_mut(w).ok()) {
        wtf.translation = base + rot * Vec3::new(-30.0, 2.0, -24.0);
        wtf.rotation = rot;
        wship.speed = wship.speed.min(wship.def.boost.unwrap_or(wship.def.speed));
    }
    radio.log(|| format!("autopilot to {np:?}"));
}

/// MissionStatus for the HUD and AiContext for the AI.
#[allow(clippy::too_many_arguments)]
fn publish_status(
    mut st: ResMut<MissionState>,
    mut status: ResMut<MissionStatus>,
    mut ctx: ResMut<AiContext>,
    ships: Query<ShipView>,
    pickups: Query<&Transform, (With<Pickup>, Without<Ship>)>,
    test: Res<TestHooks>,
    time: Res<Time>,
    players: Query<&Player, Without<Dying>>,
    mut log_t: Local<f32>,
) {
    let player_pos = alive_pos(&ships, st.player);
    if let Some(p) = st.player.and_then(|e| players.get(e).ok()) {
        st.shots = p.shots;
        st.hits = p.hits;
    }
    let hostiles = ships.iter().filter(|(_, _, s, d)| !d && s.team == Team::Aszendenz).count();
    let navs = st.navs.clone();
    let nav = navs.get(st.nav_idx);
    // where to fly
    let target = match st.phase {
        Phase::Return => alive_pos(&ships, st.carrier),
        Phase::Travel => nav.map(|n| if n.anchor { alive_pos(&ships, st.protect).unwrap_or(n.pos) } else { n.pos }),
        _ => None,
    };
    st.nav_target = target;
    status.mission = st.mission_idx;
    status.nav_pos = target;
    status.nav_name.clear();
    match (st.phase, nav) {
        (Phase::Return, _) => status.nav_name.push_str("TUS Aurora"),
        (_, Some(n)) => status.nav_name.push_str(&n.name),
        _ => {}
    }
    status.hostiles = hostiles;
    status.final_nav = st.navs.get(st.nav_idx).is_some_and(|n| n.is_final);
    status.timer = st.timer;

    // objective text (web objectiveText())
    let o = &mut status.objective;
    o.clear();
    match (st.phase, nav) {
        (Phase::Return, _) => o.push_str(if st.land_clear { "Landeanflug auf die TUS Aurora" } else { "Kehre zur TUS Aurora zurück" }),
        (Phase::Done, _) | (_, None) => o.push_str("Mission erfüllt"),
        (Phase::Travel, Some(n)) => {
            let _ = write!(o, "Fliege zu {}", n.name);
        }
        (Phase::Fight, Some(n)) => {
            let obj = n.objective.as_deref();
            let _ = match n.kind {
                NavKind::Scan => write!(o, "{} · {} %", obj.unwrap_or("Scanne den Sektor"), ((st.prog / n.scan).min(1.0) * 100.0).floor()),
                NavKind::Pickup => write!(o, "{} · {}/{}", obj.unwrap_or("Bergung"), st.pickups_got, st.pickups_total),
                NavKind::Survive => {
                    let _ = write!(o, "{} · ", obj.unwrap_or("Halte durch"));
                    write_mmss(o, st.surv)
                }
                NavKind::Convoy => {
                    let mut alive = 0;
                    let mut dist = f32::INFINITY;
                    let dest = st.convoy_dest(&ships);
                    for &e in &st.convoy {
                        if let Ok((_, tf, _, false)) = ships.get(e) {
                            alive += 1;
                            dist = dist.min(tf.translation.distance(dest.unwrap_or(tf.translation)));
                        }
                    }
                    let km = if dist.is_finite() { dist / 1000.0 } else { 0.0 };
                    write!(o, "{} · {}/{} · {:.1} km", obj.unwrap_or("Eskortiere den Konvoi"), alive, st.convoy.len(), km)
                }
                NavKind::Dock if st.docking => write!(o, "Andocken · {} %", ((st.prog / n.dock).min(1.0) * 100.0).floor()),
                _ => write!(o, "{}", obj.unwrap_or("Vernichte alle Feinde")),
            };
        }
    }
    if let Some(t) = st.timer {
        o.push_str(" · noch ");
        let _ = write_mmss(o, t);
    }

    // extra markers (entries and their label strings are reused from frame to frame)
    let mut n_markers = 0;
    if st.phase == Phase::Fight {
        if let Some(n) = nav {
            let m = &mut status.markers;
            match n.kind {
                NavKind::Pickup => {
                    for tf in &pickups {
                        set_marker(m, &mut n_markers, tf.translation, &n.pickup_label, COL_GREEN);
                    }
                }
                NavKind::Convoy => {
                    for &e in &st.convoy {
                        if let Ok((_, tf, s, false)) = ships.get(e) {
                            set_marker(m, &mut n_markers, tf.translation, &s.name, COL_GREEN);
                        }
                    }
                }
                NavKind::Scan if st.prog < n.scan => set_marker(m, &mut n_markers, n.pos, "SCANZONE", COL_GOLD),
                NavKind::Intercept => {
                    if let Some(p) = alive_pos(&ships, st.courier.map(|c| c.0)) {
                        set_marker(m, &mut n_markers, p, "KURIER", COL_RED);
                    }
                }
                NavKind::Dock if st.docking => {
                    if let Some(p) = alive_pos(&ships, st.prison) {
                        set_marker(m, &mut n_markers, p, "ANDOCKEN", COL_GREEN);
                    }
                }
                _ => {}
            }
        }
    }
    status.markers.truncate(n_markers);

    // autopilot (web autoAvailable())
    let player_held = st.bay.first().is_some_and(|p| p.player && p.held);
    status.auto_available = match (st.phase, player_pos, target) {
        _ if st.fail.is_some() || st.outcome.is_some() => false,
        // web autoAvailable(): the landing autopilot while the player still flies by hand
        (Phase::Return, Some(_), _) if st.land_clear => !player_held,
        // no jump during a launch or landing sequence
        _ if st.seq.is_some() || player_held => false,
        (Phase::Travel | Phase::Return, Some(p), Some(np)) => {
            hostiles == 0 && !(st.phase == Phase::Travel && (st.escape || st.timer.is_some())) && p.distance(np) > 2600.0
        }
        _ => false,
    };

    *ctx = AiContext { carrier: st.carrier, protect_carrier: st.protect_carrier, travel: matches!(st.phase, Phase::Travel | Phase::Return) };

    // SF_MISSION_LOG: a status line every 5 s
    *log_t -= time.delta_secs();
    if test.log && *log_t <= 0.0 {
        *log_t = 5.0;
        let p = st.player.and_then(|e| ships.get(e).ok());
        let pp = player_pos.unwrap_or(Vec3::ZERO);
        let nearest = ships.iter().filter(|(_, _, s, d)| !d && s.team == Team::Aszendenz).map(|(_, tf, _, _)| tf.translation.distance(pp)).fold(f32::INFINITY, f32::min);
        let wing = alive_pos(&ships, st.wingman).map_or(-1.0, |w| w.distance(pp));
        println!(
            "[mission] t={:.0}s {:?} nav {} | {} | hostiles {} (nearest {:.0} m) | player hp {:.0} shield {:.0} speed {:.0} | wingman {:.0} m | kills {}",
            st.time,
            st.phase,
            st.nav_idx,
            status.objective,
            hostiles,
            nearest,
            p.map_or(0.0, |p| p.2.hp),
            p.map_or(0.0, |p| p.2.shield),
            p.map_or(0.0, |p| p.2.speed),
            wing,
            st.kills
        );
    }
}

/// "m:ss" without allocating.
fn write_mmss(o: &mut String, t: f32) -> std::fmt::Result {
    let t = t.max(0.0);
    write!(o, "{}:{:02}", (t / 60.0) as u32, (t % 60.0) as u32)
}

/// Write marker `idx` (upper-case label), reusing the slot's String; appends when the list is shorter.
fn set_marker(markers: &mut Vec<(Vec3, String, [f32; 3])>, idx: &mut usize, pos: Vec3, label: &str, rgb: [f32; 3]) {
    if let Some(m) = markers.get_mut(*idx) {
        m.0 = pos;
        m.2 = rgb;
        m.1.clear();
        m.1.extend(label.chars().flat_map(char::to_uppercase));
    } else {
        markers.push((pos, label.to_uppercase(), rgb));
    }
    *idx += 1;
}

impl MissionState {
    /// convoy destination (the docking point follows the carrier)
    fn convoy_dest(&self, ships: &Query<ShipView>) -> Option<Vec3> {
        let nav = self.navs.get(self.nav_idx)?;
        nav.convoy_to.or_else(|| alive_pos(ships, self.carrier).map(|c| c + Vec3::new(0.0, -40.0, 450.0)))
    }
}

/// Mission over: debrief data (`MissionResult`, written together with `MissionEndMsg`), state change.
/// Campaign progress and story flags are menu.rs' business (it reads `MissionResult`).
fn finish_mission(
    mut st: ResMut<MissionState>,
    mut status: ResMut<MissionStatus>,
    mut result: ResMut<MissionResult>,
    mut end: MessageWriter<MissionEndMsg>,
    mut next: ResMut<NextState<AppState>>,
    test: Res<TestHooks>,
) {
    let Some((win, reason, death)) = st.outcome.clone() else { return };
    if st.ended {
        return;
    }
    st.ended = true;
    let msg = MissionEndMsg { win, reason: reason.clone() };
    status.ended = Some(msg.clone());
    end.write(msg);
    *result = MissionResult {
        mission: st.mission_idx,
        win,
        reason: reason.clone(),
        death,
        kills: st.kills,
        shots: st.shots,
        hits: st.hits,
        score: st.score,
        time: st.time,
    };
    if test.log {
        println!(
            "[mission] END mission {} win={} death={} reason='{}' kills={} score={} shots={} hits={} time={:.0}s",
            st.mission_idx, win, death, reason, st.kills, st.score, st.shots, st.hits, st.time
        );
    }
    next.set(AppState::Debrief);
}

/// SF_AUTOWIN: leave the game once the debrief is up.
fn quit_after_debrief(time: Res<Time>, mut t: Local<f32>, mut exit: MessageWriter<AppExit>) {
    *t += time.delta_secs();
    if *t > 1.0 {
        exit.write(AppExit::Success);
    }
}

/// SF_AUTOWIN cheat: flies every objective without weapons or flight.rs (end-to-end test of the mission flow).
#[allow(clippy::too_many_arguments)]
fn autowin(
    time: Res<Time>,
    mut commands: Commands,
    mut st: ResMut<MissionState>,
    mut ships: Query<(Entity, &mut Transform, &mut Ship, Has<Player>), (Without<Dying>, Without<Pickup>)>,
    pickups: Query<&Transform, (With<Pickup>, Without<Ship>)>,
    status: Res<MissionStatus>,
    mut boom: MessageWriter<ExplodeMsg>,
    mut kill_t: Local<f32>,
) {
    let dt = time.delta_secs().min(0.1);
    let navs = st.navs.clone();
    let nav = navs.get(st.nav_idx);
    let carrier = st.carrier.and_then(|c| ships.get(c).ok()).map(|(_, tf, _, _)| tf.translation);
    let courier = st.courier.map(|c| c.0);
    // vanish one hostile every 0.4 s (the courier too: intercept objective)
    *kill_t -= dt;
    if *kill_t <= 0.0 && st.phase == Phase::Fight {
        *kill_t = 0.4;
        if let Some((e, tf, s, _)) = ships.iter().find(|(e, _, s, _)| s.team == Team::Aszendenz && (Some(*e) != courier || nav.as_ref().is_some_and(|n| n.kind == NavKind::Intercept))) {
            boom.write(ExplodeMsg { pos: tf.translation, size: if s.capital() { 4.0 } else { 1.0 } });
            commands.entity(e).try_despawn();
            st.kills += 1;
            st.score += if s.def.score == 0 { 100 } else { s.def.score };
        }
    }
    // where to put the player, and how close (not during the launch or a landing: those fly for real)
    let on_rails = st.seq.is_some() || st.bay.iter().any(|p| p.player && p.held);
    let goal: Option<(Vec3, f32)> = match (st.phase, &nav) {
        _ if on_rails => None,
        (Phase::Travel, Some(n)) if n.kind == NavKind::Escape => Some((n.pos, 0.0)),
        // the autopilot (next system) takes player and wingman there when it may
        (Phase::Travel, Some(_)) if status.auto_available => None,
        (Phase::Travel, Some(n)) => Some((st.nav_target.unwrap_or(n.pos), 1800.0)),
        (Phase::Fight, Some(n)) => match n.kind {
            NavKind::Pickup => pickups.iter().next().map(|t| (t.translation, 0.0)),
            NavKind::Scan => Some((n.pos, 0.0)),
            NavKind::Dock => st.prison.and_then(|p| ships.get(p).ok()).map(|(_, tf, _, _)| (tf.translation, 60.0)),
            _ => None,
        },
        (Phase::Return, _) => carrier.map(|c| (c, 700.0)),
        _ => None,
    };
    if st.phase == Phase::Fight && nav.as_ref().is_some_and(|n| n.kind == NavKind::Survive) {
        st.surv -= dt * 8.0;
    }
    if let Some(t) = st.timer.as_mut() {
        *t += dt * 0.9; // nearly frozen
    }
    let convoy = st.convoy.clone();
    let follow = st.convoy_follow;
    for (e, mut tf, mut s, is_player) in &mut ships {
        if is_player {
            s.hp = s.max_hp;
            s.shield = s.max_shield;
            if let Some((g, close)) = goal {
                let to = tf.translation - g;
                if to.length() > close + 50.0 {
                    tf.translation = g + to.normalize_or(Vec3::Z) * close;
                }
            }
        } else if convoy.contains(&e) {
            let dest = if follow { carrier.map(|c| c + Vec3::new(0.0, -40.0, 450.0)) } else { nav.as_ref().and_then(|n| n.convoy_to) };
            if let Some(d) = dest {
                let to = d - tf.translation;
                tf.translation += to.normalize_or_zero() * (600.0 * dt).min(to.length());
            }
        }
    }
}

/// SF_TEST_KILL: destroys the named ship(s) with real damage once, to test the failure and wingman paths.
fn test_kill(mut st: ResMut<MissionState>, test: Res<TestHooks>, ships: Query<(Entity, &Transform, &Ship), Without<Dying>>, mut done: Local<bool>, mut dmg: MessageWriter<DamageMsg>) {
    let Some((who, at)) = &test.kill else { return };
    if *done || st.time < *at {
        return;
    }
    if who == "timer" {
        // run out the current time limit (it may only start at the nav: wait for it)
        if st.timer.is_some() {
            *done = true;
            st.timer = Some(0.5);
            println!("[mission] TEST: timer runs out");
        }
        return;
    }
    let victims: Vec<Entity> = match who.as_str() {
        "player" => st.player.into_iter().collect(),
        "protect" => st.protect.into_iter().collect(),
        "wingman" => st.wingman.into_iter().collect(),
        "convoy" => st.convoy.clone(),
        _ => Vec::new(),
    };
    if victims.is_empty() {
        return;
    }
    *done = true;
    println!("[mission] TEST: destroying {who} ({} ships)", victims.len());
    for e in victims {
        if let Ok((e, tf, s)) = ships.get(e) {
            dmg.write(DamageMsg { target: e, amount: (s.max_hp + s.max_shield) * 2.0 + 1.0, source: None, point: tf.translation });
        }
    }
}
