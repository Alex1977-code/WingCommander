//! Mission flow (port of src/game.js startMission / updateMission / completeNav / activateNav / spawnWave /
//! spawnPickups / autopilot / mines): carrier, player and wingman, nav points with their objective types,
//! enemy waves, radio lines, timers, fail conditions, return to the carrier, debrief.
//!
//! Test hooks (environment variables, harmless in normal play):
//! - SF_MISSION_LOG=1  print phase / nav / wave changes and the result to stdout
//! - SF_AUTOJUMP=1     use the autopilot whenever it is available (skips the long flights, for screenshots)
//! - SF_TIMESCALE=<x>  run the game clock x times faster (timer / fail tests)
//! - SF_AUTOWIN=1      cheat: player invulnerable, hostiles vanish one by one, objectives are flown for you;
//!                     the game quits after the debrief appears (end-to-end test of every mission)

use crate::ai::{facing, not_paused, AiContext, AiRng, Cruise};
use crate::common::*;
use crate::ships::{spawn_ship, ShipLibrary};
use bevy::ecs::system::SystemParam;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use std::fmt::Write as _;

pub struct MissionPlugin;

impl Plugin for MissionPlugin {
    fn build(&self, app: &mut App) {
        let test = TestHooks {
            log: env_on("SF_MISSION_LOG") || env_on("SF_AUTOWIN"),
            autowin: env_on("SF_AUTOWIN"),
            autojump: env_on("SF_AUTOJUMP"),
        };
        app.add_message::<AutopilotRequest>()
            .add_message::<BannerMsg>()
            .add_message::<WarpFlashMsg>()
            .init_resource::<MissionState>()
            .init_resource::<StoryFlags>()
            .init_resource::<MissionResult>()
            .init_resource::<ShotMines>()
            .insert_resource(test)
            .configure_sets(Update, MissionSet.run_if(in_state(AppState::Flight)).run_if(not_paused))
            .add_systems(Startup, build_assets)
            .add_systems(Startup, time_scale.run_if(|| std::env::var("SF_TIMESCALE").is_ok()))
            .add_systems(OnEnter(AppState::Flight), start_mission)
            .add_systems(OnExit(AppState::Flight), cleanup)
            .add_systems(
                Update,
                (
                    autowin.run_if(|t: Res<TestHooks>| t.autowin),
                    autopilot,
                    count_kills,
                    mine_hits,
                    update_mines,
                    update_mission,
                    jump_outs,
                    keep_alive_after_win,
                    publish_status,
                    finish_mission,
                )
                    .chain()
                    .in_set(MissionSet),
            )
            .add_systems(Update, (spin_pickups, blink_mines, warp_fx).run_if(in_state(AppState::Flight)).run_if(not_paused))
            .add_systems(Update, quit_after_debrief.run_if(in_state(AppState::Debrief)).run_if(|t: Res<TestHooks>| t.autowin));
    }
}

fn time_scale(mut time: ResMut<Time<Virtual>>) {
    if let Some(x) = std::env::var("SF_TIMESCALE").ok().and_then(|v| v.parse::<f32>().ok()).filter(|x| *x > 0.0) {
        time.set_relative_speed(x);
    }
}

fn env_on(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| !v.is_empty() && v != "0")
}

// ---------- public API ----------

/// Mission systems (Update, only in flight and not paused).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct MissionSet;

/// Sent by flight.rs when the pilot presses the autopilot key. Honoured only while `MissionStatus::auto_available`.
#[derive(Message, Clone, Copy, Debug, Default)]
pub struct AutopilotRequest;

/// Big centre-screen announcement ("SEKTOR GESICHERT", "NEUE FEINDWELLE", ...) for hud.rs.
#[allow(dead_code)]
#[derive(Message, Clone, Debug)]
pub struct BannerMsg(pub String);

/// Story flags from earlier missions and dialogue choices (owner: menu.rs / campaign flow). They switch
/// conditional wave entries (`["klinge", 1, "holtEscaped"]`) and radio lines (`if` / `ifNot`).
#[derive(Resource, Default, Clone, Debug)]
pub struct StoryFlags(pub HashSet<String>);

/// Statistics of the last finished mission (for the debrief screen, menu.rs).
#[allow(dead_code)]
#[derive(Resource, Default, Clone, Debug)]
pub struct MissionResult {
    pub mission: usize,
    pub win: bool,
    pub reason: String,
    /// the player died (retry) rather than failing an objective (story may branch)
    pub death: bool,
    pub kills: u32,
    pub shots: u32,
    pub hits: u32,
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

#[derive(Component)]
struct Mine {
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
    glow_mesh: Handle<Mesh>,
    mine_glow_mat: Handle<StandardMaterial>,
    pickup_mesh: Handle<Mesh>,
    pickup_mat: Handle<StandardMaterial>,
    pickup_glow_mat: Handle<StandardMaterial>,
}

#[derive(Resource, Clone, Copy, Default)]
struct TestHooks {
    log: bool,
    autowin: bool,
    autojump: bool,
}

const WARP_POOL: usize = 8;
const ENEMY_TOUGH: f32 = 1.7;
const COL_GREEN: [f32; 3] = [0.43, 1.0, 0.69];
const COL_GOLD: [f32; 3] = [1.0, 0.78, 0.34];
const COL_RED: [f32; 3] = [1.0, 0.3, 0.43];

fn build_assets(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>) {
    let ico = |r: f32, sub: u32| Sphere::new(r).mesh().ico(sub).unwrap_or_else(|_| Sphere::new(r).mesh().build());
    let mine_mesh = meshes.add(ico(3.0, 0));
    let spike_mesh = meshes.add(Cylinder::new(0.45, 4.0));
    let glow_mesh = meshes.add(ico(1.0, 2));
    let pickup_mesh = meshes.add(ico(3.2, 0));
    let mine_mat = mats.add(StandardMaterial {
        base_color: Color::srgb(0.16, 0.10, 0.13),
        metallic: 0.8,
        perceptual_roughness: 0.35,
        emissive: LinearRgba::rgb(0.5, 0.05, 0.1),
        ..default()
    });
    let mine_glow_mat = mats.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.1, 0.08, 0.55),
        emissive: LinearRgba::rgb(8.0, 0.8, 0.6),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        fog_enabled: false,
        ..default()
    });
    let pickup_mat = mats.add(StandardMaterial {
        base_color: Color::srgb(0.3, 1.0, 0.6),
        emissive: LinearRgba::rgb(1.2, 6.0, 2.8),
        unlit: true,
        ..default()
    });
    let pickup_glow_mat = mats.add(StandardMaterial {
        base_color: Color::srgba(0.3, 1.0, 0.5, 0.18),
        emissive: LinearRgba::rgb(0.5, 2.2, 1.0),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        fog_enabled: false,
        ..default()
    });
    commands.insert_resource(MissionAssets { mine_mesh, spike_mesh, mine_mat, glow_mesh, mine_glow_mat, pickup_mesh, pickup_mat, pickup_glow_mat });
}

// ---------- spawning ----------

#[derive(SystemParam)]
struct Spawner<'w, 's> {
    commands: Commands<'w, 's>,
    lib: Res<'w, ShipLibrary>,
    data: Res<'w, GameData>,
    rng: ResMut<'w, AiRng>,
    flags: Res<'w, StoryFlags>,
}

#[derive(SystemParam)]
struct Radio<'w> {
    comm: MessageWriter<'w, CommMsg>,
    sfx: MessageWriter<'w, SfxMsg>,
    banner: MessageWriter<'w, BannerMsg>,
    warp: MessageWriter<'w, WarpFlashMsg>,
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
        self.banner.write(BannerMsg(text.to_string()));
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

fn spawn_pickups(commands: &mut Commands, assets: &MissionAssets, rng: &mut AiRng, nav: &NavPlan) -> usize {
    for i in 0..nav.pickups {
        let a = (i as f32 / nav.pickups as f32) * std::f32::consts::TAU + rng.range(-0.3, 0.3);
        let r = rng.range(250.0, 520.0);
        let pos = nav.pos + Vec3::new(a.cos() * r, rng.range(-120.0, 120.0), a.sin() * r);
        commands
            .spawn((Pickup, InMission, Transform::from_translation(pos), Visibility::default(), Name::new("Bergungsobjekt")))
            .with_children(|p| {
                p.spawn((Mesh3d(assets.pickup_mesh.clone()), MeshMaterial3d(assets.pickup_mat.clone()), Transform::default(), NotShadowCaster));
                p.spawn((
                    Mesh3d(assets.glow_mesh.clone()),
                    MeshMaterial3d(assets.pickup_glow_mat.clone()),
                    Transform::from_scale(Vec3::splat(11.0)),
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
                Hittable { radius: 5.0, half_extents: None },
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
                    Mesh3d(assets.glow_mesh.clone()),
                    MeshMaterial3d(assets.mine_glow_mat.clone()),
                    Transform::from_scale(Vec3::splat(3.0)),
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
) {
    let idx = radio.progress.current.min(sp.data.campaign.missions.len().saturating_sub(1));
    let m = sp.data.mission(idx).clone();
    // raw JSON of the mission's navs: the typed `Line` drops the `if`/`ifNot` conditions
    let raw: Option<Value> = std::fs::read_to_string(data_dir().join("campaign.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    let raw_navs = raw.as_ref().and_then(|r| r.get("missions")?.get(idx)?.get("navs")?.as_array().cloned());
    let navs: Vec<NavPlan> = m.navs.iter().enumerate().map(|(i, n)| NavPlan::from(n, raw_navs.as_ref().and_then(|a| a.get(i)))).collect();
    let protect_kind = m.extra.get("protect").and_then(Value::as_str).map(str::to_string);

    *st = MissionState {
        mission_idx: idx,
        no_return: m.extra.get("noReturn").and_then(Value::as_bool).unwrap_or(false),
        protect_carrier: protect_kind.as_deref() == Some("carrier"),
        ..default()
    };

    // carrier at the origin, cruising slowly along +Z
    let carrier = spawn_ai_ship(&mut sp, "aurora", Vec3::ZERO, Vec3::Z, Ai::default(), None, None);
    st.carrier = Some(carrier);
    if st.protect_carrier {
        st.protect = Some(carrier);
    }

    // the player, launched in front of the carrier
    let ptf = Transform::from_xyz(70.0, -4.0, 300.0);
    let player = spawn_ship(&mut sp.commands, &sp.lib, &sp.data, &m.ship, ptf);
    let mut pship = Ship::new(&m.ship, sp.data.ship(&m.ship));
    pship.speed = 160.0;
    pship.name = radio.progress.callsign.clone();
    sp.commands
        .entity(player)
        .insert((pship, Player { throttle: 0.75, energy: 1.0, want_speed: 160.0, ..default() }, Trigger::default(), Name::new("Spieler")));
    st.player = Some(player);

    // wingman: same ship type, on the left
    if let Some(who) = m.wingman.clone().filter(|w| !w.is_empty()) {
        let call = call_sign(&who);
        let ai = Ai { wingman: true, who: Some(who), skill: 0.75, ..default() };
        st.wingman = Some(spawn_ai_ship(&mut sp, &m.ship, Vec3::new(40.0, -8.0, 270.0), Vec3::Z, ai, Some(call), Some(160.0)));
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
        let material = mats.add(warp_material(0.0));
        sp.commands.spawn((
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
    radio.log(|| format!("start mission {} '{}' ({} navs, ship {}, wingman {:?})", idx, m.title, st.navs.len(), m.ship, m.wingman));
    activate_nav(&mut *st, &mut sp, &mut radio, Some(ptf.translation), Vec3::Z);
    radio.say("flug", "Startfreigabe erteilt. Klare Bahn, {cs}!");
}

/// Wingman's radio call sign: "rook" -> "Rook".
fn call_sign(who: &str) -> String {
    let mut c = who.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_else(|| "Flügelmann".into())
}

fn cleanup(mut commands: Commands, q: Query<Entity, With<InMission>>, mut ctx: ResMut<AiContext>) {
    for e in &q {
        commands.entity(e).try_despawn();
    }
    *ctx = AiContext::default();
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

fn count_kills(mut kills: MessageReader<KilledMsg>, mut st: ResMut<MissionState>) {
    for k in kills.read() {
        if k.by_player && k.team == Team::Aszendenz {
            st.kills += 1;
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
) {
    // timers run on game time (Time<Virtual> already caps a hitch at 0.25 s)
    let dt = time.delta_secs();
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
        if !st.land_clear && near(cpos, 1800.0) {
            let threat = ships.iter().any(|(_, tf, s, d)| !d && s.team == Team::Aszendenz && !s.capital() && tf.translation.distance(cpos) < 3500.0);
            if !threat {
                st.land_clear = true;
                radio.say("flug", "Landefreigabe Bucht eins, {cs}. Anflug frei – oder AUTO für den Landeautopiloten.");
                radio.banner("LANDEFREIGABE · BUCHT 1");
                radio.sfx.write(SfxMsg::Beep);
            } else if !st.land_warned {
                st.land_warned = true;
                radio.say("flug", "Negativ, {cs} – Feindkontakt am Träger. Erst den Sektor säubern, dann Landefreigabe.");
            }
        }
        if st.land_clear && near(cpos, 800.0) {
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
                    st.pickups_total = spawn_pickups(&mut sp.commands, &assets, &mut sp.rng, &nav);
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
            spawn_wave(&mut sp, &mut radio, &nav, 0, center, Some(ppos), false);
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
            spawn_wave(&mut sp, &mut radio, &nav, idx, center, Some(ppos), cycle && st.wave >= nav.waves.len());
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
/// The shot-down wingman's jump-out is weapons.rs' business.
fn jump_outs(mut commands: Commands, st: Res<MissionState>, ships: Query<(Entity, &Transform, &Ship), Without<Dying>>, mut radio: Radio) {
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

/// Mines hit by weapons fire this frame (reading and writing DamageMsg in one system is not allowed).
#[derive(Resource, Default)]
struct ShotMines(Vec<Entity>);

fn mine_hits(mut hits: MessageReader<DamageMsg>, mines: Query<(), With<Mine>>, mut shot: ResMut<ShotMines>) {
    for h in hits.read() {
        if mines.contains(h.target) {
            shot.0.push(h.target);
        }
    }
}

/// Mines home in on Union ships within 170 m and explode within 20 m (75 m blast). Shooting one sets it off.
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
    let dt = time.delta_secs().min(0.1);
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
        tf.scale = Vec3::splat(if on { 4.2 } else { 1.8 });
    }
}

fn spin_pickups(time: Res<Time>, mut q: Query<&mut Transform, (With<Pickup>, Without<Ship>)>) {
    let dt = time.delta_secs();
    for mut tf in &mut q {
        tf.rotate_y(dt * 2.0);
    }
}

fn warp_material(k: f32) -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgba(0.5, 0.8, 1.0, k),
        emissive: LinearRgba::rgb(4.0 * k, 6.0 * k, 10.0 * k),
        unlit: true,
        alpha_mode: AlphaMode::Add,
        fog_enabled: false,
        ..default()
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
        fl.size = m.size * 0.5;
        tf.translation = m.pos;
        tf.scale = Vec3::splat(fl.size * 0.2);
        *vis = Visibility::Visible;
    }
    let dt = time.delta_secs();
    for (mut fl, mut tf, mut vis) in &mut pool {
        if fl.t <= 0.0 {
            continue;
        }
        fl.t -= dt;
        let k = (fl.t / fl.life).clamp(0.0, 1.0);
        tf.scale = Vec3::splat(fl.size * (0.2 + (1.0 - k) * 0.8));
        if let Some(mut m) = mats.get_mut(&fl.material) {
            let w = warp_material(k * k);
            m.base_color = w.base_color;
            m.emissive = w.emissive;
        }
        if fl.t <= 0.0 {
            *vis = Visibility::Hidden;
        }
    }
}

/// Autopilot (web autopilot()): jump to 2.3 km before the nav point, or land when cleared to.
fn autopilot(
    mut req: MessageReader<AutopilotRequest>,
    status: Res<MissionStatus>,
    mut st: ResMut<MissionState>,
    mut player: Query<(&mut Transform, &mut Ship, &mut Player), Without<Dying>>,
    mut others: Query<(&mut Transform, &mut Ship), (Without<Player>, Without<Dying>)>,
    mut radio: Radio,
) {
    let asked = req.read().count() > 0;
    if !asked && !(radio.test.autojump && status.auto_available) {
        return;
    }
    if !status.auto_available || st.outcome.is_some() {
        radio.sfx.write(SfxMsg::Beep);
        return;
    }
    let Ok((mut ptf, mut pship, mut pl)) = player.single_mut() else { return };
    let Some(np) = st.nav_target else { return };
    let lp = ptf.translation;
    let back = (lp - np).normalize_or(Vec3::NEG_Z);
    radio.sfx.write(SfxMsg::Warp);
    pl.impulse = false;
    pl.impulse_prog = 0.0;
    pl.boosting = false;
    if st.phase == Phase::Return && st.land_clear {
        // landing autopilot: in, slow and steady
        ptf.translation = np + back * 600.0;
        ptf.rotation = facing(-back, Vec3::Y);
        pship.speed = pship.speed.min(120.0);
        radio.log(|| "landing autopilot".into());
        land(&mut *st, &mut radio);
        return;
    }
    let rot = facing(-back, Vec3::Y);
    let base = np + back * 2300.0;
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
fn publish_status(
    mut st: ResMut<MissionState>,
    mut status: ResMut<MissionStatus>,
    mut ctx: ResMut<AiContext>,
    ships: Query<ShipView>,
    pickups: Query<&Transform, (With<Pickup>, Without<Ship>)>,
    test: Res<TestHooks>,
    time: Res<Time>,
    mut log_t: Local<f32>,
) {
    let player_pos = alive_pos(&ships, st.player);
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
    status.timer = st.timer;

    // objective text (web objectiveText())
    let fmt = |t: f32| {
        let t = t.max(0.0);
        format!("{}:{:02}", (t / 60.0).floor() as u32, (t % 60.0).floor() as u32)
    };
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
                NavKind::Survive => write!(o, "{} · {}", obj.unwrap_or("Halte durch"), fmt(st.surv)),
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
        let _ = write!(o, " · noch {}", fmt(t));
    }

    // extra markers
    status.markers.clear();
    if st.phase == Phase::Fight {
        if let Some(n) = nav {
            match n.kind {
                NavKind::Pickup => {
                    for tf in &pickups {
                        status.markers.push((tf.translation, n.pickup_label.clone(), COL_GREEN));
                    }
                }
                NavKind::Convoy => {
                    for &e in &st.convoy {
                        if let Ok((_, tf, s, false)) = ships.get(e) {
                            status.markers.push((tf.translation, s.name.to_uppercase(), COL_GREEN));
                        }
                    }
                }
                NavKind::Scan if st.prog < n.scan => status.markers.push((n.pos, "SCANZONE".into(), COL_GOLD)),
                NavKind::Intercept => {
                    if let Some(p) = alive_pos(&ships, st.courier.map(|c| c.0)) {
                        status.markers.push((p, "KURIER".into(), COL_RED));
                    }
                }
                NavKind::Dock if st.docking => {
                    if let Some(p) = alive_pos(&ships, st.prison) {
                        status.markers.push((p, "ANDOCKEN".into(), COL_GREEN));
                    }
                }
                _ => {}
            }
        }
    }

    // autopilot (web autoAvailable())
    status.auto_available = match (st.phase, player_pos, target) {
        _ if st.fail.is_some() || st.outcome.is_some() => false,
        (Phase::Return, Some(_), _) if st.land_clear => true,
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

impl MissionState {
    /// convoy destination (the docking point follows the carrier)
    fn convoy_dest(&self, ships: &Query<ShipView>) -> Option<Vec3> {
        let nav = self.navs.get(self.nav_idx)?;
        nav.convoy_to.or_else(|| alive_pos(ships, self.carrier).map(|c| c + Vec3::new(0.0, -40.0, 450.0)))
    }
}

/// Mission over: debrief data, progress, state change.
#[allow(clippy::too_many_arguments)]
fn finish_mission(
    mut st: ResMut<MissionState>,
    mut status: ResMut<MissionStatus>,
    mut result: ResMut<MissionResult>,
    mut progress: ResMut<Progress>,
    player: Query<&Player>,
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
    let (shots, hits) = player.iter().next().map_or((0, 0), |p| (p.shots, p.hits));
    *result = MissionResult { mission: st.mission_idx, win, reason: reason.clone(), death, kills: st.kills, shots, hits, time: st.time };
    progress.total_kills += st.kills;
    if win {
        progress.unlocked = progress.unlocked.max(st.mission_idx + 1);
    }
    save_json("progress.json", &*progress);
    if test.log {
        println!("[mission] END mission {} win={} reason='{}' kills={} time={:.0}s", st.mission_idx, win, reason, st.kills, st.time);
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
        }
    }
    // where to put the player, and how close
    let goal: Option<(Vec3, f32)> = match (st.phase, &nav) {
        (Phase::Travel, Some(n)) if n.kind == NavKind::Escape => Some((n.pos, 0.0)),
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
