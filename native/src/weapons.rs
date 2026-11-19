//! Weapons: laser bolts (fighters and capital ship turrets), the player's neutron cannon with seeker lock,
//! Aszendenz plasma seekers and bombers' fusion torpedoes, damage (shields, hull, kills) and dying ships.
//!
//! Gameplay numbers follow the web version (src/game.js). Projectiles are plain data in `Projectiles`;
//! their visuals are pooled entities (no spawning while fighting): an opaque unlit HDR core (it writes depth
//! and motion vectors, so DLSS/TAA reproject it correctly) inside additive glow shells.
//!
//! Hits: fighters are spheres, capitals their box core plus the model hull (`ships::HullBoxes`), asteroids
//! their ellipsoid (`render::Asteroid`), mines (`flight::Obstacle`) spheres.

use crate::common::*;
use crate::flight::{seg_point, segment_hull_shape, FlightSet, Obstacle, MAX_DT};
use crate::render::{Asteroid, CameraShake};
use crate::ships::{HullBoxes, HullShape, ShipLibrary, TurretHead};
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy::window::PrimaryWindow;
use std::f32::consts::TAU;
use std::sync::Arc;

// ---------- tuning (web values) ----------

/// shield recharge: pause after a hit, then this share of the maximum per second
pub const SHIELD_DELAY: f32 = 4.5;
const SHIELD_REGEN: f32 = 0.1;
/// aim assist: lead point within this range and inside ~4 degrees
const ASSIST_RANGE: f32 = 1100.0;
const ASSIST_COS: f32 = 0.9975;
const TURRET_RANGE: f32 = 1500.0;
/// neutron beam visual lifetime
const LANCE_LIFE: f32 = 0.42;
/// player wreck stays (camera keeps looking at the explosion) before the entity goes
const PLAYER_DEATH_T: f32 = 3.0;
const CAPITAL_DEATH_T: f32 = 2.6;
/// the player's hit credit for a kill lasts this long
const CREDIT_T: f32 = 8.0;
/// AI muzzle flashes / sounds only near the player
const MUZZLE_FAR: f32 = 1200.0;
const LASER_EAR: f32 = 900.0;
/// plasma seekers (web launchMissile): damage vs fighters, multiplier vs capitals
const SEEKER_DMG: f32 = 75.0;
const SEEKER_CAP_MUL: f32 = 2.4;
const TORPEDO_DMG: f32 = 170.0;
/// minimum time between two seekers of one ship, whatever ai.rs asks for
const SEEKER_GUARD: f32 = 3.0;

const COL_SHIELD: LinearRgba = LinearRgba::rgb(0.6, 1.6, 3.0);
const COL_SPARK: LinearRgba = LinearRgba::rgb(3.0, 1.8, 0.6);
const LANCE_CORE: LinearRgba = LinearRgba::rgb(2.6, 3.2, 4.0);
const LANCE_GLOW: LinearRgba = LinearRgba::rgb(0.35, 0.85, 2.4);

const BEAM_SLOTS: usize = 4;
const BEAM_SEGS: usize = 14;

// ---------- public API ----------

#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WeaponsSet {
    /// lock-on, guns, turrets, neutron cannon
    Fire,
    /// bolts, seekers, beams, flashes
    Projectiles,
    /// DamageMsg -> shields / hull / kills
    Damage,
    /// exploding ships, despawn
    Dying,
}

/// The player's aim assist (for the HUD's lead indicator).
#[derive(Component, Default, Clone, Copy, Debug)]
pub struct PlayerAim {
    /// where to shoot to hit the current target
    pub lead: Option<Vec3>,
    /// guns converge on `lead` (target close and inside the assist cone)
    pub locked: bool,
}

/// The player's neutron cannon (for HUD and cockpit).
#[derive(Component, Default, Clone, Copy, Debug)]
pub struct Neutron {
    /// seconds left until the charging cannon discharges
    pub charge: Option<f32>,
    /// the locked target the charging beam will bend to
    pub target: Option<Entity>,
    /// result of the last discharge: Some(true) hit, Some(false) missed
    pub last_hit: Option<bool>,
    lock_target: Option<Entity>,
    tone_t: f32,
}

/// An enemy seeker is homing on the player (HUD warning).
#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct SeekerWarning(pub bool);

/// A wingman whose ship was shot to pieces jumped out (no kill; despawned like a dying ship).
#[derive(Component, Clone, Copy, Debug)]
pub struct JumpedOut;

/// Bolt looks: Union fighters, Aszendenz fighters, Union / Aszendenz turrets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoltKind {
    Ally,
    Foe,
    Turret,
    TurretFoe,
}

impl BoltKind {
    const ALL: [BoltKind; 4] = [BoltKind::Ally, BoltKind::Foe, BoltKind::Turret, BoltKind::TurretFoe];
    /// coloured halo (HDR, web COL table)
    pub fn color(self) -> LinearRgba {
        match self {
            BoltKind::Ally => LinearRgba::rgb(0.5, 2.2, 4.5),
            BoltKind::Foe => LinearRgba::rgb(4.5, 0.5, 1.2),
            BoltKind::Turret => LinearRgba::rgb(1.2, 4.0, 1.0),
            BoltKind::TurretFoe => LinearRgba::rgb(4.5, 1.6, 0.3),
        }
    }
    /// white-hot core
    fn core(self) -> LinearRgba {
        match self {
            BoltKind::Ally => LinearRgba::rgb(3.4, 5.2, 7.0),
            BoltKind::Foe => LinearRgba::rgb(7.0, 3.2, 3.8),
            BoltKind::Turret => LinearRgba::rgb(4.0, 7.0, 3.4),
            BoltKind::TurretFoe => LinearRgba::rgb(7.0, 4.6, 2.2),
        }
    }
    /// length and halo half-width (m)
    fn size(self) -> (f32, f32) {
        match self {
            BoltKind::Ally | BoltKind::Foe => (20.0, 1.2),
            BoltKind::Turret | BoltKind::TurretFoe => (30.0, 1.6),
        }
    }
    fn idx(self) -> usize {
        self as usize
    }
}

// ---------- plugin ----------

pub struct WeaponsPlugin;

/// Ends every seeker/torpedo of the given team that is still in flight (web completeNav: team-1 missiles life = 0).
#[derive(Message, Clone, Copy, Debug)]
pub struct CancelSeekersMsg(pub Team);

impl Plugin for WeaponsPlugin {
    fn build(&self, app: &mut App) {
        let running = |p: Res<Paused>| !p.0;
        app.add_message::<CancelSeekersMsg>()
            .init_resource::<Projectiles>()
            .init_resource::<TargetCache>()
            .init_resource::<SeekerWarning>()
            .init_resource::<WeaponClock>()
            .insert_resource(WRng(0x9E37_79B9_7F4A_7C15))
            .configure_sets(
                Update,
                (WeaponsSet::Fire, WeaponsSet::Projectiles, WeaponsSet::Damage, WeaponsSet::Dying)
                    .chain()
                    .after(FlightSet::Collide)
                    .run_if(in_state(AppState::Flight))
                    .run_if(running),
            )
            .add_systems(Startup, setup_weapons)
            .add_systems(OnExit(AppState::Flight), clear_weapons)
            .add_systems(
                Update,
                (ensure_armament, build_cache, shields, player_aim, fire_weapons, neutron_cannon, turrets).chain().in_set(WeaponsSet::Fire),
            )
            .add_systems(Update, (update_bolts, update_seekers, update_beams, update_flashes, aim_turret_heads).chain().in_set(WeaponsSet::Projectiles))
            .add_systems(Update, apply_damage.in_set(WeaponsSet::Damage))
            .add_systems(Update, dying.in_set(WeaponsSet::Dying));
        if std::env::var("SF_PILOT").is_ok() {
            app.add_systems(Update, debug_log.after(WeaponsSet::Dying).run_if(in_state(AppState::Flight)));
        }
    }
}

/// SF_PILOT test runs: once a second, what the weapons see.
fn debug_log(time: Res<Time>, mut t: Local<f32>, cache: Res<TargetCache>, proj: Res<Projectiles>, players: Query<(&Transform, &Ship, &Player)>) {
    *t += time.delta_secs();
    if *t < 1.0 {
        return;
    }
    *t = 0.0;
    for (tf, ship, p) in &players {
        let tgt = p.target.and_then(|e| cache.get(e)).map(|t| t.pos().distance(tf.translation));
        info!(
            "pilot pos {:.0} speed {:.0} energy {:.2} impulse {} {:.2} hp {:.0}/{:.0} target {:?} lock {:.2} shots {} hits {} kills {} | bolts {} seekers {} ships {}",
            tf.translation, ship.speed, p.energy, p.impulse, p.impulse_prog, ship.hp, ship.shield, tgt, p.lock, p.shots, p.hits, p.kills, proj.bolts.len(), proj.seekers.len(), cache.ships.len()
        );
    }
}

// ---------- internal state ----------

/// Small xorshift generator (no extra crate).
#[derive(Resource)]
struct WRng(u64);

impl WRng {
    fn f(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + self.f() * (b - a)
    }
    fn dir(&mut self) -> Vec3 {
        let z = self.range(-1.0, 1.0);
        let a = self.f() * TAU;
        let r = (1.0 - z * z).sqrt();
        Vec3::new(r * a.cos(), r * a.sin(), z)
    }
}

/// Mission time that stands still while paused (kill credit).
#[derive(Resource, Default)]
struct WeaponClock(f32);

/// Per-ship weapon bookkeeping (added to every ship automatically).
#[derive(Component, Default)]
struct Armament {
    turret_cool: Vec<f32>,
    /// where each turret last aimed (ship space, unit; zero = never fired): the visible heads follow it
    turret_dir: Vec<Vec3>,
    /// farthest model point from the ship's origin (web `modelR`)
    extent: f32,
    seeker_cool: f32,
    /// elapsed time of the last hit by the player (kill credit)
    player_hit_at: Option<f32>,
    /// capital death: time to the next secondary explosion
    boom_t: f32,
}

/// Marker on pooled visual entities whose transforms weapons.rs drives.
#[derive(Component)]
struct WeaponVis;

struct Bolt {
    pos: Vec3,
    vel: Vec3,
    dir: Vec3,
    life: f32,
    traveled: f32,
    team: Team,
    owner: Entity,
    dmg: f32,
    kind: BoltKind,
    vis: Entity,
    fresh: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SeekerKind {
    Ally,
    Foe,
    Torpedo,
}

struct Seeker {
    pos: Vec3,
    rot: Quat,
    speed: f32,
    max_speed: f32,
    turn: f32,
    life: f32,
    target: Option<Entity>,
    team: Team,
    owner: Entity,
    kind: SeekerKind,
    phase: f32,
    vis: (Entity, Entity),
    fresh: bool,
}

struct Flash {
    vis: Entity,
    ship: Entity,
    local: Vec3,
    t: f32,
    size: f32,
    kind: usize,
}

#[derive(Default)]
struct Beam {
    active: bool,
    t: f32,
    owner: Option<Entity>,
    local: Vec3,
    from: Vec3,
    end: Vec3,
    /// segments: opaque core and additive glow (siblings, so the core can thin out under a steady glow)
    segs: Vec<(Entity, Entity)>,
    glow: Handle<StandardMaterial>,
}

struct Assets3 {
    sphere: Handle<Mesh>,
    ico: Handle<Mesh>,
    cone: Handle<Mesh>,
    bolt: [[Handle<StandardMaterial>; 3]; 4],
    flash: [Handle<StandardMaterial>; 4],
    /// core, inner halo, outer halo, tail per seeker kind
    seeker: [[Handle<StandardMaterial>; 4]; 3],
}

/// All live projectiles and the pools of their visuals.
#[derive(Resource, Default)]
struct Projectiles {
    assets: Option<Assets3>,
    bolts: Vec<Bolt>,
    bolt_free: [Vec<Entity>; 4],
    seekers: Vec<Seeker>,
    seeker_free: [Vec<(Entity, Entity)>; 3],
    flashes: Vec<Flash>,
    flash_free: [Vec<Entity>; 4],
    beams: Vec<Beam>,
}

/// Snapshot of everything that can be hit this frame (after movement), shared by all weapon systems.
#[derive(Resource, Default)]
struct TargetCache {
    ships: Vec<Tgt>,
    rocks: Vec<(Transform, Asteroid)>,
    /// mines and other `Obstacle`s that are not asteroids: (centre, radius)
    obstacles: Vec<(Vec3, f32)>,
    player: Option<(Entity, Vec3, Team)>,
    /// camera position and world size of one pixel at distance 1
    eye: Vec3,
    px: f32,
}

struct Tgt {
    e: Entity,
    tf: Transform,
    hit: Hittable,
    torus: Option<[f32; 2]>,
    /// capitals: the model hull (shared, an Arc clone per frame)
    shape: Option<Arc<HullShape>>,
    /// broad-phase radius: max(Hittable::radius, model extent)
    reach: f32,
    /// model extent (web modelR)
    extent: f32,
    team: Team,
    capital: bool,
    player: bool,
    speed: f32,
    ai_target: Option<Entity>,
}

impl Tgt {
    fn shape(&self) -> Option<&HullShape> {
        self.shape.as_deref()
    }
    fn pos(&self) -> Vec3 {
        self.tf.translation
    }
    fn fwd(&self) -> Vec3 {
        self.tf.rotation * Vec3::Z
    }
}

impl TargetCache {
    fn get(&self, e: Entity) -> Option<&Tgt> {
        self.ships.iter().find(|t| t.e == e)
    }
}

// ---------- setup / pools ----------

fn emissive(c: LinearRgba, k: f32) -> StandardMaterial {
    StandardMaterial {
        base_color: Color::LinearRgba(LinearRgba::new(c.red * k, c.green * k, c.blue * k, 1.0)),
        unlit: true,
        fog_enabled: false,
        alpha_mode: AlphaMode::Add,
        ..default()
    }
}

/// The white-hot core: opaque unlit HDR, so it writes depth and motion vectors (DLSS/TAA).
fn core_mat(c: LinearRgba, k: f32) -> StandardMaterial {
    StandardMaterial { alpha_mode: AlphaMode::Opaque, ..emissive(c, k) }
}

fn setup_weapons(mut commands: Commands, mut proj: ResMut<Projectiles>, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>) {
    let sphere = meshes.add(Sphere::new(1.0).mesh().uv(14, 8));
    let ico = meshes.add(Sphere::new(1.0).mesh().ico(1).expect("icosphere"));
    let cone = meshes.add(
        Cone { radius: 1.0, height: 1.0 }
            .mesh()
            .resolution(10)
            .build()
            .rotated_by(Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2))
            .translated_by(Vec3::new(0.0, 0.0, -0.5)),
    );
    let cyl = meshes.add(Cylinder::new(1.0, 1.0).mesh().resolution(10).build());
    let bolt = BoltKind::ALL.map(|k| [mats.add(core_mat(k.core(), 1.4)), mats.add(emissive(k.color(), 0.55)), mats.add(emissive(k.color(), 0.09))]);
    let flash = BoltKind::ALL.map(|k| mats.add(emissive(k.color(), 0.9)));
    let plasma = |core: LinearRgba, halo: LinearRgba, trail: LinearRgba, mats: &mut Assets<StandardMaterial>| {
        [mats.add(core_mat(core, 1.6)), mats.add(emissive(halo, 0.45)), mats.add(emissive(halo, 0.1)), mats.add(emissive(trail, 0.35))]
    };
    let seeker = [
        plasma(LinearRgba::rgb(1.6, 2.6, 3.8), LinearRgba::rgb(0.5, 1.2, 2.6), LinearRgba::rgb(0.35, 0.9, 2.2), &mut mats),
        plasma(LinearRgba::rgb(3.8, 0.9, 1.9), LinearRgba::rgb(2.6, 0.35, 0.9), LinearRgba::rgb(2.2, 0.3, 0.8), &mut mats),
        plasma(LinearRgba::rgb(3.2, 1.4, 3.8), LinearRgba::rgb(1.9, 0.5, 2.8), LinearRgba::rgb(1.5, 0.4, 2.2), &mut mats),
    ];
    let assets = Assets3 { sphere, ico, cone, bolt, flash, seeker };

    // neutron beams: fixed slots of cylinder segments, each slot with its own (fading) materials
    proj.beams.clear();
    for _ in 0..BEAM_SLOTS {
        // the core cannot fade (opaque): it thins out instead, the additive glow fades
        let core = mats.add(core_mat(LANCE_CORE, 1.0));
        let glow = mats.add(emissive(LANCE_GLOW, 0.4));
        let segs = (0..BEAM_SEGS)
            .map(|_| {
                let mut seg = |mat: &Handle<StandardMaterial>| {
                    commands.spawn((WeaponVis, Mesh3d(cyl.clone()), MeshMaterial3d(mat.clone()), NotShadowCaster, Transform::default(), Visibility::Hidden)).id()
                };
                (seg(&core), seg(&glow))
            })
            .collect();
        proj.beams.push(Beam { segs, glow, ..default() });
    }

    // prewarm the pools so the first dogfight does not spawn anything
    for k in BoltKind::ALL {
        for _ in 0..if matches!(k, BoltKind::Ally | BoltKind::Foe) { 96 } else { 48 } {
            let e = spawn_bolt_vis(&mut commands, &assets, k);
            proj.bolt_free[k.idx()].push(e);
        }
        for _ in 0..12 {
            let e = spawn_flash_vis(&mut commands, &assets, k.idx());
            proj.flash_free[k.idx()].push(e);
        }
    }
    for k in 0..3 {
        for _ in 0..8 {
            let v = spawn_seeker_vis(&mut commands, &assets, k);
            proj.seeker_free[k].push(v);
        }
    }
    proj.assets = Some(assets);
}

fn spawn_bolt_vis(commands: &mut Commands, a: &Assets3, k: BoltKind) -> Entity {
    // nested additive shells fake the soft falloff of a glow: white-hot core, coloured halo, faint outer haze
    let [core, mid, haze] = a.bolt[k.idx()].clone();
    let root = commands.spawn((WeaponVis, Transform::default(), Visibility::Hidden, Name::new("Bolt"))).id();
    for (mat, s) in [(core, Vec3::new(0.13, 0.13, 0.9)), (mid, Vec3::new(0.38, 0.38, 0.97)), (haze, Vec3::new(0.85, 0.85, 1.06))] {
        commands.spawn((Mesh3d(a.sphere.clone()), MeshMaterial3d(mat), NotShadowCaster, Transform::from_scale(s), ChildOf(root)));
    }
    root
}

fn spawn_flash_vis(commands: &mut Commands, a: &Assets3, k: usize) -> Entity {
    commands
        .spawn((WeaponVis, Mesh3d(a.sphere.clone()), MeshMaterial3d(a.flash[k].clone()), NotShadowCaster, Transform::default(), Visibility::Hidden))
        .id()
}

/// Seeker visual: root (core) and the pulsing outer halo, which weapons.rs scales.
fn spawn_seeker_vis(commands: &mut Commands, a: &Assets3, k: usize) -> (Entity, Entity) {
    let [core, inner, outer, tail] = a.seeker[k].clone();
    let root = commands.spawn((WeaponVis, Transform::default(), Visibility::Hidden, Name::new("Seeker"))).id();
    commands.spawn((Mesh3d(a.ico.clone()), MeshMaterial3d(core), NotShadowCaster, Transform::from_scale(Vec3::splat(1.2)), ChildOf(root)));
    commands.spawn((Mesh3d(a.sphere.clone()), MeshMaterial3d(inner), NotShadowCaster, Transform::from_scale(Vec3::splat(2.8)), ChildOf(root)));
    commands.spawn((Mesh3d(a.cone.clone()), MeshMaterial3d(tail), NotShadowCaster, Transform::from_scale(Vec3::new(0.9, 0.9, 11.0)), ChildOf(root)));
    let halo = commands.spawn((WeaponVis, Mesh3d(a.sphere.clone()), MeshMaterial3d(outer), NotShadowCaster, Transform::from_scale(Vec3::splat(6.0)), ChildOf(root))).id();
    (root, halo)
}

/// Mission over: everything in flight goes back to the pools.
fn clear_weapons(mut proj: ResMut<Projectiles>, mut vis: Query<&mut Visibility, With<WeaponVis>>, mut warn: ResMut<SeekerWarning>) {
    let p = &mut *proj;
    for b in p.bolts.drain(..) {
        hide(&mut vis, b.vis);
        p.bolt_free[b.kind.idx()].push(b.vis);
    }
    for s in p.seekers.drain(..) {
        hide(&mut vis, s.vis.0);
        p.seeker_free[s.kind as usize].push(s.vis);
    }
    for f in p.flashes.drain(..) {
        hide(&mut vis, f.vis);
        p.flash_free[f.kind].push(f.vis);
    }
    for beam in &mut p.beams {
        beam.active = false;
        for &(c, g) in &beam.segs {
            hide(&mut vis, c);
            hide(&mut vis, g);
        }
    }
    warn.0 = false;
}

fn hide(vis: &mut Query<&mut Visibility, With<WeaponVis>>, e: Entity) {
    if let Ok(mut v) = vis.get_mut(e) {
        v.set_if_neq(Visibility::Hidden);
    }
}

// ---------- fire stage ----------

fn ensure_armament(
    mut commands: Commands,
    lib: Res<ShipLibrary>,
    ships: Query<(Entity, &Ship), Without<Armament>>,
    players: Query<Entity, (With<Player>, Without<Neutron>)>,
    mut rng: ResMut<WRng>,
) {
    for (e, ship) in &ships {
        let turret_cool = ship.def.turrets.iter().map(|_| rng.range(0.0, 2.0)).collect();
        let turret_dir = vec![Vec3::ZERO; ship.def.turrets.len()];
        let extent = lib.model(&ship.kind).map_or(0.0, |m| m.extent);
        commands.entity(e).insert(Armament { turret_cool, turret_dir, extent, seeker_cool: rng.range(2.0, 5.0), ..default() });
    }
    for e in &players {
        commands.entity(e).insert((Neutron::default(), PlayerAim::default()));
    }
}

fn build_cache(
    mut cache: ResMut<TargetCache>,
    ships: Query<(Entity, &Transform, &Ship, &Hittable, Has<Player>, Option<&Ai>, Option<&HullBoxes>, Option<&Armament>), Without<Dying>>,
    rocks: Query<(&Transform, &Asteroid)>,
    obstacles: Query<(&Transform, &Obstacle), Without<Asteroid>>,
    camera: Query<(&GlobalTransform, &Projection), With<MainCamera>>,
    windows: Query<&Window, With<PrimaryWindow>>,
) {
    if let Ok((gt, proj)) = camera.single() {
        let fov = match proj {
            Projection::Perspective(p) => p.fov,
            _ => 1.0,
        };
        let h = windows.single().map_or(1080.0, |w| w.physical_height().max(1) as f32);
        cache.eye = gt.translation();
        cache.px = 2.0 * (fov * 0.5).tan() / h;
    }
    cache.ships.clear();
    cache.rocks.clear();
    cache.obstacles.clear();
    cache.player = None;
    for (e, tf, ship, hit, player, ai, hull, arm) in &ships {
        if player {
            cache.player = Some((e, tf.translation, ship.team));
        }
        if ship.def.ghost {
            continue;
        }
        let shape = hull.map(|h| h.0.clone());
        let extent = shape.as_ref().map_or(0.0, |s| s.extent).max(arm.map_or(0.0, |a| a.extent));
        cache.ships.push(Tgt {
            e,
            tf: *tf,
            hit: *hit,
            torus: ship.def.torus,
            shape,
            reach: hit.radius.max(extent),
            extent,
            team: ship.team,
            capital: ship.capital(),
            player,
            speed: ship.speed,
            ai_target: ai.and_then(|a| a.target),
        });
    }
    for (tf, rock) in &rocks {
        cache.rocks.push((*tf, *rock));
    }
    for (tf, o) in &obstacles {
        cache.obstacles.push((tf.translation, o.radius));
    }
}

/// Shields recharge after a pause without hits.
fn shields(time: Res<Time>, mut clock: ResMut<WeaponClock>, mut q: Query<&mut Ship, Without<Dying>>) {
    let dt = time.delta_secs().min(MAX_DT);
    clock.0 += dt;
    for mut s in &mut q {
        s.shield_t += dt;
        if s.shield_t > SHIELD_DELAY && s.shield < s.max_shield {
            s.shield = (s.shield + s.max_shield * SHIELD_REGEN * dt).min(s.max_shield);
        }
    }
}

/// Lead point + aim assist and the neutron seeker lock (web updatePilot).
fn player_aim(
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut q: Query<(&Transform, &Ship, &mut Player, &mut PlayerAim, &mut Neutron), Without<Dying>>,
    mut sfx: MessageWriter<SfxMsg>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let lock_cos = LOCK_CONE_DEG.to_radians().cos();
    for (tf, ship, mut player, mut aim, mut neutron) in &mut q {
        let f = fwd(tf);
        let tgt = player.target.and_then(|t| cache.get(t));
        aim.lead = None;
        aim.locked = false;
        if let Some(t) = tgt {
            let dist = t.pos().distance(tf.translation);
            let lead = t.pos() + t.fwd() * t.speed * dist / BOLT_SPEED;
            aim.lead = Some(lead);
            aim.locked = !t.capital && dist < ASSIST_RANGE && (lead - tf.translation).normalize_or_zero().dot(f) > ASSIST_COS;
        }
        // seeker: the target has to stay inside the cone within range for LOCK_TIME
        if neutron.lock_target != player.target {
            neutron.lock_target = player.target;
            player.lock = 0.0;
        }
        match tgt {
            Some(t) if ship.missiles > 0 => {
                let v = t.pos() - tf.translation;
                let d = v.length();
                let in_cone = d < LANCE_RANGE && v.dot(f) > d * lock_cos;
                let was = player.lock;
                player.lock = if in_cone { (player.lock + dt / LOCK_TIME).min(1.0) } else { (player.lock - dt * 1.5).max(0.0) };
                if was < 1.0 && player.lock >= 1.0 {
                    sfx.write(SfxMsg::Lock);
                }
                // seeker growl that speeds up while locking
                neutron.tone_t -= dt;
                if player.lock > 0.0 && player.lock < 1.0 && neutron.tone_t <= 0.0 {
                    neutron.tone_t = 0.34 - player.lock * 0.22;
                    sfx.write(SfxMsg::Beep);
                }
            }
            _ => player.lock = 0.0,
        }
    }
}

/// Guns of every fighter (Trigger.guns), plasma seekers / torpedoes of AI ships and the player's neutron trigger.
#[allow(clippy::too_many_arguments)]
fn fire_weapons(
    mut commands: Commands,
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut proj: ResMut<Projectiles>,
    mut rng: ResMut<WRng>,
    mut sfx: MessageWriter<SfxMsg>,
    mut q: Query<
        (Entity, &Transform, &mut Ship, &mut Trigger, &mut Armament, Option<&mut Player>, Option<&PlayerAim>, Option<&mut Neutron>, Option<&Ai>),
        Without<Dying>,
    >,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let ear = cache.player.map(|p| p.1);
    for (e, tf, mut ship, mut trig, mut arm, mut player, aim, neutron, ai) in &mut q {
        arm.seeker_cool -= dt;
        // guns: carry the remainder so the cadence does not depend on the frame rate
        ship.cool -= dt;
        let wants = trig.guns && !ship.def.guns.is_empty() && !ship.capital();
        if wants && ship.cool <= 0.0 {
            ship.cool = (ship.cool + ship.def.rof.max(0.02)).max(0.0);
            let is_player = player.is_some();
            let f = fwd(tf);
            let aim_point = match aim {
                Some(a) if a.locked => a.lead,
                Some(_) => None,
                None => trig.aim,
            };
            // AI wingmen and allied fighters support the player instead of winning the fight for them
            let dmg = if is_player || ship.team != Team::Union {
                ship.def.dmg
            } else {
                ship.def.dmg * if ai.is_some_and(|a| a.wingman) { 0.25 } else { 0.35 }
            };
            let kind = if ship.team == Team::Aszendenz { BoltKind::Foe } else { BoltKind::Ally };
            let near = is_player || ear.is_some_and(|p| p.distance_squared(tf.translation) < MUZZLE_FAR * MUZZLE_FAR);
            for g in &ship.def.guns {
                let local = Vec3::from_array(*g);
                let muzzle = tf.translation + tf.rotation * local;
                let dir = aim_point.map_or(f, |a| {
                    let d = (a - muzzle).normalize_or_zero();
                    if d.dot(f) > 0.85 { d } else { f }
                });
                spawn_bolt(&mut commands, &mut proj, muzzle, dir, e, ship.team, dmg, kind);
                if near {
                    spawn_flash(&mut commands, &mut proj, e, local + Vec3::Z * 1.5, kind.idx(), if is_player { 1.4 } else { 2.2 });
                }
            }
            if let Some(p) = player.as_mut() {
                p.shots += ship.def.guns.len() as u32;
                sfx.write(SfxMsg::Laser { enemy: false });
            } else if ear.is_some_and(|p| p.distance_squared(tf.translation) < LASER_EAR * LASER_EAR) {
                sfx.write(SfxMsg::Laser { enemy: ship.team == Team::Aszendenz });
            }
        } else if ship.cool < 0.0 {
            ship.cool = 0.0;
        }

        if !trig.missile {
            continue;
        }
        trig.missile = false;
        if let Some(mut n) = neutron {
            // player: start charging the neutron cannon (a locked seeker bends the beam onto the target)
            if ship.missiles == 0 || n.charge.is_some() {
                if n.charge.is_none() {
                    sfx.write(SfxMsg::Beep);
                }
                continue;
            }
            ship.missiles -= 1;
            n.charge = Some(LANCE_CHARGE);
            // only a held lock steers the beam; without it the cannon fires straight along the nose
            n.target = player.as_mut().and_then(|p| {
                let locked = p.target.filter(|t| p.lock >= 1.0 && cache.get(*t).is_some());
                p.lock = 0.0;
                locked
            });
            sfx.write(SfxMsg::LanceCharge);
            continue;
        }
        // AI: plasma seeker at its target, bombers launch fusion torpedoes
        if arm.seeker_cool > 0.0 || ship.capital() {
            continue;
        }
        let Some(target) = ai.and_then(|a| a.target).filter(|t| cache.get(*t).is_some()) else { continue };
        let kind = if ship.def.bomber {
            SeekerKind::Torpedo
        } else if ship.missiles > 0 {
            ship.missiles -= 1;
            if ship.team == Team::Union { SeekerKind::Ally } else { SeekerKind::Foe }
        } else {
            continue;
        };
        arm.seeker_cool = SEEKER_GUARD;
        let pos = tf.translation + tf.rotation * Vec3::new(0.0, -1.6, 2.0);
        let (speed, max_speed, turn, life) = match kind {
            SeekerKind::Torpedo => (300.0, 300.0, 0.7, 14.0),
            SeekerKind::Ally => ((ship.speed + 150.0).max(380.0), 620.0, 2.6, 7.0),
            SeekerKind::Foe => ((ship.speed + 150.0).max(380.0), 620.0, 1.35, 7.0),
        };
        let p = &mut *proj;
        let assets = p.assets.as_ref().expect("weapon assets");
        let vis = p.seeker_free[kind as usize].pop().unwrap_or_else(|| spawn_seeker_vis(&mut commands, assets, kind as usize));
        p.seekers.push(Seeker {
            pos,
            rot: tf.rotation,
            speed,
            max_speed,
            turn,
            life,
            target: Some(target),
            team: ship.team,
            owner: e,
            kind,
            phase: rng.range(0.0, 6.0),
            vis,
            fresh: true,
        });
        if ear.is_some_and(|p| p.distance_squared(pos) < 1200.0 * 1200.0) {
            sfx.write(SfxMsg::LanceCharge);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_bolt(commands: &mut Commands, proj: &mut Projectiles, pos: Vec3, dir: Vec3, owner: Entity, team: Team, dmg: f32, kind: BoltKind) {
    let assets = proj.assets.as_ref().expect("weapon assets");
    let vis = proj.bolt_free[kind.idx()].pop().unwrap_or_else(|| spawn_bolt_vis(commands, assets, kind));
    proj.bolts.push(Bolt { pos, vel: dir * BOLT_SPEED, dir, life: BOLT_LIFE, traveled: 0.0, team, owner, dmg, kind, vis, fresh: true });
}

fn spawn_flash(commands: &mut Commands, proj: &mut Projectiles, ship: Entity, local: Vec3, kind: usize, size: f32) {
    let assets = proj.assets.as_ref().expect("weapon assets");
    let vis = proj.flash_free[kind].pop().unwrap_or_else(|| spawn_flash_vis(commands, assets, kind));
    proj.flashes.push(Flash { vis, ship, local, t: 0.0, size, kind });
}

/// Charge and discharge the player's neutron cannon: an instant beam that bends onto a locked target.
#[allow(clippy::too_many_arguments)]
fn neutron_cannon(
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut proj: ResMut<Projectiles>,
    mut rng: ResMut<WRng>,
    mut q: Query<(Entity, &Transform, &Ship, &mut Player, &mut Neutron), Without<Dying>>,
    mut damage: MessageWriter<DamageMsg>,
    mut hitfx: MessageWriter<HitFxMsg>,
    mut sfx: MessageWriter<SfxMsg>,
    mut shake: ResMut<CameraShake>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    for (e, tf, ship, mut player, mut n) in &mut q {
        let Some(t) = n.charge.as_mut() else { continue };
        *t -= dt;
        if *t > 0.0 {
            continue;
        }
        n.charge = None;
        let local = Vec3::new(0.0, -1.4, ship.def.radius.max(8.0) * 0.7);
        let from = tf.translation + tf.rotation * local;
        let f = fwd(tf);
        let mut dir = f;
        if let Some(t) = n.target.and_then(|t| cache.get(t)) {
            // the field emitters can only swing the beam so far: a target far off the nose gets a straight shot
            let v = t.pos() - from;
            let d = v.length();
            if d < LANCE_RANGE + t.reach && v.dot(f) > d * 0.7 {
                dir = v / d;
            }
        }
        let hit = lance_ray(&cache, from, dir, LANCE_RANGE, ship.team);
        let mut end = from + dir * hit.map_or(LANCE_RANGE, |h| h.0);
        if let Some(t) = hit.and_then(|h| h.1).map(|i| &cache.ships[i]) {
            if !t.capital {
                end = t.pos() + rng.dir() * t.hit.radius * 0.25;
            }
            let amount = if t.capital { LANCE_CAP_DMG } else { LANCE_DMG };
            damage.write(DamageMsg { target: t.e, amount, source: Some(e), point: end });
        } else if hit.is_some() {
            // a rock or a mine took the beam (a mine goes off: mission.rs reads ship-less impacts)
            hitfx.write(HitFxMsg { pos: end, ship: Entity::PLACEHOLDER, shield: false, color: COL_SPARK });
        }
        n.last_hit = Some(hit.is_some_and(|h| h.1.is_some()));
        player.shots += 1;
        sfx.write(SfxMsg::Lance);
        shake.bump(0.25);
        // a free slot, or the one closest to fading out
        let slot = proj.beams.iter().position(|b| !b.active).or_else(|| (0..proj.beams.len()).min_by(|&a, &b| proj.beams[a].t.total_cmp(&proj.beams[b].t)));
        if let Some(beam) = slot.map(|i| &mut proj.beams[i]) {
            beam.active = true;
            beam.t = LANCE_LIFE;
            beam.owner = Some(e);
            beam.local = local;
            beam.from = from;
            beam.end = end;
        }
    }
}

/// First thing a beam from `from` along unit `dir` hits within `max_d`: (distance, index into cache.ships
/// or None for a rock).
fn lance_ray(cache: &TargetCache, from: Vec3, dir: Vec3, max_d: f32, team: Team) -> Option<(f32, Option<usize>)> {
    let mut best = max_d;
    let mut hit = None;
    let mut found = false;
    let sphere_entry = |c: Vec3, r: f32| -> Option<f32> {
        let m = c - from;
        let tc = m.dot(dir);
        let d2 = m.length_squared() - tc * tc;
        if d2 > r * r {
            return None;
        }
        let h = (r * r - d2).sqrt();
        (tc + h >= 0.0).then_some((tc - h).max(0.0))
    };
    for (i, t) in cache.ships.iter().enumerate() {
        if t.team == team {
            continue;
        }
        if t.capital {
            // prows and towers reach past the radius (web: max(radius, modelR) + 6)
            let Some(enter) = sphere_entry(t.pos(), t.reach + 6.0) else { continue };
            if enter >= best {
                continue;
            }
            if let Some((_, k)) = segment_hull_shape(&t.tf, &t.hit, t.torus, t.shape(), from, from + dir * best, 2.5) {
                best *= k;
                hit = Some(i);
                found = true;
            }
        } else if let Some(d) = sphere_entry(t.pos(), t.hit.radius + 5.0).filter(|d| *d < best) {
            best = d;
            hit = Some(i);
            found = true;
        }
    }
    for (tf, rock) in &cache.rocks {
        if let Some(d) = rock.ray(tf, from, dir, best) {
            best = d;
            hit = None;
            found = true;
        }
    }
    for &(c, r) in &cache.obstacles {
        if let Some(d) = sphere_entry(c, r).filter(|d| *d < best) {
            best = d;
            hit = None;
            found = true;
        }
    }
    found.then_some((best, hit))
}

/// Capital ship turrets: each picks the nearest hostile in range and fires a led bolt with some spread.
#[allow(clippy::too_many_arguments)]
fn turrets(
    mut commands: Commands,
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut proj: ResMut<Projectiles>,
    mut rng: ResMut<WRng>,
    mut caps: Query<(Entity, &Transform, &Ship, &mut Armament), Without<Dying>>,
    players: Query<&Player>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let player_target = players.iter().next().and_then(|p| p.target);
    for (e, tf, ship, mut arm) in &mut caps {
        if !ship.capital() || ship.def.turrets.is_empty() || ship.team == Team::Neutral {
            continue;
        }
        let kind = if ship.team == Team::Union { BoltKind::Turret } else { BoltKind::TurretFoe };
        for (i, tpos) in ship.def.turrets.iter().enumerate() {
            let Some(cool) = arm.turret_cool.get_mut(i) else { break };
            *cool -= dt;
            if *cool > 0.0 {
                continue;
            }
            *cool = rng.range(0.7, 1.3);
            let muzzle = tf.translation + tf.rotation * Vec3::from_array(*tpos);
            let mut best: Option<(&Tgt, f32)> = None;
            for t in &cache.ships {
                if !ship.team.hostile_to(t.team) {
                    continue;
                }
                let d2 = t.pos().distance_squared(muzzle);
                if d2 < TURRET_RANGE * TURRET_RANGE && best.is_none_or(|b| d2 < b.1) {
                    best = Some((t, d2));
                }
            }
            let Some((t, d2)) = best else { continue };
            let ally = ship.team == Team::Union && !t.capital;
            // friendly guns hold fire on a fighter that is dogfighting the player up close: that kill is the player's
            if ally {
                if let Some((pe, ppos, _)) = cache.player {
                    if (player_target == Some(t.e) || t.ai_target == Some(pe)) && ppos.distance_squared(t.pos()) < 700.0 * 700.0 {
                        continue;
                    }
                }
            }
            let dist = d2.sqrt();
            let lead = t.pos() + t.fwd() * t.speed * dist / BOLT_SPEED;
            let spread = if t.capital { 0.03 } else if ally { 0.09 } else { 0.05 };
            let dir = ((lead - muzzle).normalize_or(Vec3::Z) + rng.dir() * spread).normalize();
            let dmg = if ally { ship.def.dmg * 0.25 } else { ship.def.dmg };
            spawn_bolt(&mut commands, &mut proj, muzzle, dir, e, ship.team, dmg, kind);
            if let Some(d) = arm.turret_dir.get_mut(i) {
                *d = tf.rotation.inverse() * dir;
            }
        }
    }
}

// ---------- projectiles ----------

/// Moves bolts, tests the segment travelled this frame against every hull (no tunnelling) and rocks.
fn update_bolts(
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut proj: ResMut<Projectiles>,
    mut vis: Query<(&mut Transform, &mut Visibility), With<WeaponVis>>,
    mut damage: MessageWriter<DamageMsg>,
    mut fx: MessageWriter<HitFxMsg>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let p = &mut *proj;
    let mut i = 0;
    while i < p.bolts.len() {
        let b = &mut p.bolts[i];
        let prev = b.pos;
        b.pos += b.vel * dt;
        b.traveled += BOLT_SPEED * dt;
        b.life -= dt;
        let mut done = b.life <= 0.0;
        if !done {
            for t in &cache.ships {
                if t.team == b.team || t.e == b.owner {
                    continue;
                }
                let hit = if t.capital {
                    let r = t.reach + 4.0;
                    if seg_point(prev, b.pos, t.pos()).0 > r * r {
                        continue;
                    }
                    segment_hull_shape(&t.tf, &t.hit, t.torus, t.shape(), prev, b.pos, 2.5).map(|h| h.0)
                } else {
                    // web: the player is a little smaller, other fighters a little larger than their radius
                    let rr = if t.player { t.hit.radius * 0.85 } else { (t.hit.radius * 1.15).max(t.extent * 0.92) };
                    let (d2, pt) = seg_point(prev, b.pos, t.pos());
                    (d2 < rr * rr).then_some(pt)
                };
                if let Some(point) = hit {
                    damage.write(DamageMsg { target: t.e, amount: b.dmg, source: Some(b.owner), point });
                    done = true;
                    break;
                }
            }
        }
        if !done {
            let seg = b.pos - prev;
            let len = seg.length();
            let dir = seg / len.max(1e-4);
            // sparks on a rock or a mine (no ship: Entity::PLACEHOLDER)
            let pt = cache
                .rocks
                .iter()
                .find_map(|(tf, rock)| rock.ray(tf, prev, dir, len).map(|t| prev + dir * t))
                .or_else(|| cache.obstacles.iter().find_map(|&(c, r)| seg_hit(prev, b.pos, c, r)));
            if let Some(pt) = pt {
                fx.write(HitFxMsg { pos: pt, ship: Entity::PLACEHOLDER, shield: false, color: COL_SPARK });
                done = true;
            }
        }
        if done {
            let b = p.bolts.swap_remove(i);
            if let Ok((_, mut v)) = vis.get_mut(b.vis) {
                v.set_if_neq(Visibility::Hidden);
            }
            p.bolt_free[b.kind.idx()].push(b.vis);
            continue;
        }
        // draw: a glowing streak behind the head, no longer than the distance flown (never inside the gun)
        let (len, w) = b.kind.size();
        let vis_len = len.min(b.traveled);
        if let Ok((mut tf, mut v)) = vis.get_mut(b.vis) {
            if b.fresh {
                // first frame: just move it into place (a pooled entity must not smear across the screen)
                tf.rotation = Quat::from_rotation_arc(Vec3::Z, b.dir);
                b.fresh = false;
            } else {
                v.set_if_neq(Visibility::Visible);
            }
            let mid = b.pos - b.dir * vis_len * 0.5;
            // never thinner than a few pixels, so distant bolts stay readable (web: uPx)
            let w = w.max(mid.distance(cache.eye) * cache.px * 2.6);
            tf.translation = mid;
            tf.scale = Vec3::new(w, w, (vis_len * 0.5).max(0.1));
        }
        i += 1;
    }
}

/// Homing plasma seekers: accelerate, turn towards the target's lead point, burst on contact.
#[allow(clippy::too_many_arguments)]
fn update_seekers(
    time: Res<Time>,
    cache: Res<TargetCache>,
    mut proj: ResMut<Projectiles>,
    mut rng: ResMut<WRng>,
    mut vis: Query<(&mut Transform, &mut Visibility), With<WeaponVis>>,
    mut damage: MessageWriter<DamageMsg>,
    mut explode: MessageWriter<ExplodeMsg>,
    mut warn: ResMut<SeekerWarning>,
    mut cancel: MessageReader<CancelSeekersMsg>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let p = &mut *proj;
    let player = cache.player.map(|p| p.0);
    // nav point cleared: that side's seekers and torpedoes still in flight fizzle out (web completeNav)
    let mut cancelled = [false; 3];
    for c in cancel.read() {
        cancelled[team_idx(c.0)] = true;
    }
    let mut warning = false;
    let mut i = 0;
    while i < p.seekers.len() {
        let m = &mut p.seekers[i];
        if cancelled[team_idx(m.team)] {
            m.life = 0.0;
        }
        m.life -= dt;
        m.speed = (m.speed + 260.0 * dt).min(m.max_speed);
        let tgt = m.target.and_then(|t| cache.get(t));
        if let Some(t) = tgt {
            let mut v = t.pos() - m.pos;
            let d = v.length();
            if !t.capital {
                v += t.fwd() * t.speed * (d / m.speed).min(1.5);
            }
            let want = crate::flight::rotation_facing(v, m.rot * Vec3::Y);
            m.rot = m.rot.rotate_towards(want, m.turn * dt).normalize();
            warning |= Some(t.e) == player && m.team != t.team;
        } else {
            m.target = None;
        }
        let prev = m.pos;
        m.pos += m.rot * Vec3::Z * m.speed * dt;
        m.phase += dt * 32.0;
        let mut boom = m.life <= 0.0;
        if !boom {
            for t in &cache.ships {
                if t.team == m.team || t.e == m.owner {
                    continue;
                }
                let hit = if t.capital {
                    // swept like the bolts, so a fast seeker cannot slip through a saucer rim or a blade
                    let r = t.reach + 10.0;
                    m.pos.distance_squared(t.pos()) < r * r && segment_hull_shape(&t.tf, &t.hit, t.torus, t.shape(), prev, m.pos, 5.0).is_some()
                } else {
                    let r = t.hit.radius + 7.0;
                    seg_point(prev, m.pos, t.pos()).0 < r * r
                };
                if hit {
                    let amount = match m.kind {
                        SeekerKind::Torpedo => TORPEDO_DMG,
                        _ if t.capital => SEEKER_DMG * SEEKER_CAP_MUL,
                        _ => SEEKER_DMG,
                    };
                    damage.write(DamageMsg { target: t.e, amount, source: Some(m.owner), point: m.pos });
                    boom = true;
                    break;
                }
            }
        }
        if !boom {
            boom = cache.rocks.iter().any(|(tf, rock)| rock.depth(tf, m.pos, 0.0).is_some())
                || cache.obstacles.iter().any(|&(c, r)| m.pos.distance_squared(c) < r * r);
        }
        if boom {
            if m.life > 0.0 {
                explode.write(ExplodeMsg { pos: m.pos, size: if m.kind == SeekerKind::Torpedo { 1.0 } else { 0.6 } });
            }
            let m = p.seekers.swap_remove(i);
            if let Ok((_, mut v)) = vis.get_mut(m.vis.0) {
                v.set_if_neq(Visibility::Hidden);
            }
            p.seeker_free[m.kind as usize].push(m.vis);
            continue;
        }
        let scale = if m.kind == SeekerKind::Torpedo { 1.7 } else { 1.0 };
        if let Ok((mut tf, mut v)) = vis.get_mut(m.vis.0) {
            if m.fresh {
                m.fresh = false;
            } else {
                v.set_if_neq(Visibility::Visible);
            }
            *tf = Transform { translation: m.pos, rotation: m.rot, scale: Vec3::splat(scale) };
        }
        if let Ok((mut tf, _)) = vis.get_mut(m.vis.1) {
            tf.scale = Vec3::splat(6.0 * (0.85 + m.phase.sin() * 0.15 + rng.f() * 0.06));
        }
        i += 1;
    }
    warn.0 = warning;
}

/// Neutron beams: a curve that leaves the emitter straight ahead and bends onto the hit point, fading out.
fn update_beams(
    time: Res<Time>,
    mut proj: ResMut<Projectiles>,
    owners: Query<&Transform, (With<Ship>, Without<WeaponVis>)>,
    mut vis: Query<(&mut Transform, &mut Visibility), With<WeaponVis>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut rng: ResMut<WRng>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    for beam in proj.beams.iter_mut().filter(|b| b.active) {
        beam.t -= dt;
        if beam.t <= 0.0 {
            beam.active = false;
            for &(c, g) in &beam.segs {
                for s in [c, g] {
                    if let Ok((_, mut v)) = vis.get_mut(s) {
                        v.set_if_neq(Visibility::Hidden);
                    }
                }
            }
            continue;
        }
        // the emitter stays on the ship's nose while the beam lives
        let mut f = (beam.end - beam.from).normalize_or(Vec3::Z);
        if let Some(otf) = beam.owner.and_then(|o| owners.get(o).ok()) {
            beam.from = otf.translation + otf.rotation * beam.local;
            f = fwd(otf);
        }
        let k = beam.t / LANCE_LIFE;
        let flicker = 0.85 + rng.f() * 0.3;
        // the opaque core keeps its colour and thins out as the charge bleeds off (was: k * k brightness)
        let core_w = (k * k * flicker).min(1.0);
        if let Some(mut m) = mats.get_mut(&beam.glow) {
            let g = 0.4 * k * flicker;
            m.base_color = Color::LinearRgba(LinearRgba::new(LANCE_GLOW.red * g, LANCE_GLOW.green * g, LANCE_GLOW.blue * g, 1.0));
        }
        let ctrl = beam.from + f * beam.from.distance(beam.end) * 0.45;
        let bez = |t: f32| {
            let u = 1.0 - t;
            beam.from * (u * u) + ctrl * (2.0 * u * t) + beam.end * (t * t)
        };
        // thick at the emitter burst, thinning as the charge bleeds off
        let width = 0.35 + 0.45 * k;
        let fresh = beam.t > LANCE_LIFE - dt * 1.5;
        let mut a = bez(0.0);
        for (i, &(core, glow)) in beam.segs.iter().enumerate() {
            let b = bez((i + 1) as f32 / BEAM_SEGS as f32);
            let seg = b - a;
            let len = seg.length();
            let rot = Quat::from_rotation_arc(Vec3::Y, seg / len.max(1e-4));
            for (s, w, on) in [(core, width * core_w, core_w > 0.04), (glow, width * 3.2, true)] {
                if let Ok((mut tf, mut v)) = vis.get_mut(s) {
                    *tf = Transform { translation: (a + b) * 0.5, rotation: rot, scale: Vec3::new(w, len + width, w) };
                    if !fresh {
                        v.set_if_neq(if on { Visibility::Visible } else { Visibility::Hidden });
                    }
                }
            }
            a = b;
        }
    }
}

/// Short muzzle flashes riding on the gun.
fn update_flashes(
    time: Res<Time>,
    mut proj: ResMut<Projectiles>,
    owners: Query<&Transform, (With<Ship>, Without<WeaponVis>)>,
    mut vis: Query<(&mut Transform, &mut Visibility), With<WeaponVis>>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let p = &mut *proj;
    let mut i = 0;
    while i < p.flashes.len() {
        let f = &mut p.flashes[i];
        f.t += dt;
        let owner = owners.get(f.ship).ok();
        if f.t > 0.07 || owner.is_none() {
            let f = p.flashes.swap_remove(i);
            if let Ok((_, mut v)) = vis.get_mut(f.vis) {
                v.set_if_neq(Visibility::Hidden);
            }
            p.flash_free[f.kind].push(f.vis);
            continue;
        }
        if let (Some(otf), Ok((mut tf, mut v))) = (owner, vis.get_mut(f.vis)) {
            let k = 1.0 - f.t / 0.07;
            tf.translation = otf.translation + otf.rotation * f.local;
            tf.rotation = otf.rotation;
            tf.scale = Vec3::new(f.size * 0.6, f.size * 0.6, f.size * 1.6) * (0.4 + 0.6 * k);
            v.set_if_neq(Visibility::Visible);
        }
        i += 1;
    }
}

/// The visible turret heads swing towards where their turret last fired (yaw on the mount, some elevation).
fn aim_turret_heads(time: Res<Time>, arms: Query<&Armament>, mut heads: Query<(&TurretHead, &mut Transform), Without<WeaponVis>>) {
    let dt = time.delta_secs().min(MAX_DT);
    for (h, mut tf) in &mut heads {
        let Some(dir) = arms.get(h.ship).ok().and_then(|a| a.turret_dir.get(h.idx).copied()).filter(|d| *d != Vec3::ZERO) else { continue };
        let l = h.base.inverse() * dir;
        let yaw = l.x.atan2(l.z);
        let elev = l.y.atan2(l.x.hypot(l.z)).clamp(0.0, 0.9);
        let want = Quat::from_rotation_y(yaw) * Quat::from_rotation_x(-elev);
        let rot = tf.rotation.rotate_towards(want, 2.5 * dt);
        if rot != tf.rotation {
            tf.rotation = rot;
        }
    }
}

// ---------- damage ----------

/// DamageMsg -> shield, then hull; kills, wingman jump-outs, statistics, hit effects and sounds.
#[allow(clippy::too_many_arguments)]
fn apply_damage(
    mut commands: Commands,
    clock: Res<WeaponClock>,
    cache: Res<TargetCache>,
    mut shake: ResMut<CameraShake>,
    mut reader: MessageReader<DamageMsg>,
    mut ships: DamageQuery,
    mut killed: MessageWriter<KilledMsg>,
    mut explode: MessageWriter<ExplodeMsg>,
    mut hitfx: MessageWriter<HitFxMsg>,
    mut sfx: MessageWriter<SfxMsg>,
    mut comm: MessageWriter<CommMsg>,
    mut bodies: Query<&mut Visibility, With<ShipBody>>,
) {
    let now = clock.0;
    let player = cache.player;
    let pe = player.map(|p| p.0);
    for msg in reader.read() {
        let by_player = msg.source.is_some() && msg.source == pe;
        let Ok((mut ship, tf, mut arm, mut pl, ai, children)) = ships.get_mut(msg.target) else { continue };
        if ship.hp <= 0.0 || ship.def.ghost {
            continue;
        }
        let shielded = ship.shield > 0.0;
        let color = if shielded { COL_SHIELD } else { COL_SPARK };
        hitfx.write(HitFxMsg { pos: msg.point, ship: msg.target, shield: shielded, color });
        if ship.def.invulnerable {
            continue;
        }
        ship.shield_t = 0.0;
        if shielded {
            ship.shield -= msg.amount;
            if ship.shield < 0.0 {
                ship.hp += ship.shield;
                ship.shield = 0.0;
            }
        } else {
            ship.hp -= msg.amount;
        }
        let is_player = pl.is_some();
        if is_player {
            sfx.write(if shielded { SfxMsg::ShieldHit } else { SfxMsg::HullHit });
            shake.add(msg.amount * 0.035, 1.2);
        }
        if by_player {
            arm.player_hit_at = Some(now);
        }
        if ship.hp > 0.0 {
            if by_player {
                count(&mut ships, pe, |p| p.hits += 1);
            }
            continue;
        }

        // ---- destroyed ----
        let pos = tf.translation;
        if let Some(ai) = ai.filter(|a| a.wingman) {
            // the wingman's ship is shot up: he jumps out instead of dying
            let who = ai.who.clone().unwrap_or_default();
            commands.entity(msg.target).insert((Dying { t: 0.0 }, JumpedOut, Visibility::Hidden));
            comm.write(CommMsg { who, text: "Ich bin getroffen! Muss abdrehen – ihr seid auf euch allein gestellt!".into() });
            sfx.write(SfxMsg::Warp);
            continue;
        }
        let hostile = player.is_some_and(|p| ship.team.hostile_to(p.2));
        let recent = arm.player_hit_at.is_some_and(|t| now - t < CREDIT_T);
        let credit = by_player || (recent && hostile);
        let capital = ship.capital();
        let t = if is_player {
            PLAYER_DEATH_T
        } else if capital {
            CAPITAL_DEATH_T
        } else {
            0.1
        };
        commands.entity(msg.target).insert(Dying { t });
        if let Some(p) = pl.as_mut() {
            // the wreck stays where it blew up (the camera keeps looking) until it is removed
            ship.speed = 0.0;
            shake.bump(2.0);
            p.target = None;
            p.boosting = false;
            p.impulse = false;
            for c in children.into_iter().flat_map(|c| c.iter()) {
                if let Ok(mut v) = bodies.get_mut(c) {
                    *v = Visibility::Hidden;
                }
            }
        }
        killed.write(KilledMsg { entity: msg.target, kind: ship.kind.clone(), team: ship.team, by_player: credit, pos });
        let size = if capital {
            3.0
        } else if is_player {
            1.3
        } else {
            1.0
        };
        explode.write(ExplodeMsg { pos, size });
        if player.is_none_or(|p| p.1.distance_squared(pos) < 3000.0 * 3000.0) {
            sfx.write(SfxMsg::Explosion { size });
        }
        count(&mut ships, pe, |p| {
            if by_player {
                p.hits += 1;
            }
            if credit && hostile {
                p.kills += 1;
            }
        });
    }
}

type DamageQuery<'w, 's> = Query<
    'w,
    's,
    (&'static mut Ship, &'static Transform, &'static mut Armament, Option<&'static mut Player>, Option<&'static Ai>, Option<&'static Children>),
    Without<Dying>,
>;

/// Update the player's statistics (while the player is alive).
fn count(ships: &mut DamageQuery, player: Option<Entity>, f: impl FnOnce(&mut Player)) {
    if let Some(Ok((_, _, _, Some(mut p), _, _))) = player.map(|e| ships.get_mut(e)) {
        f(&mut p);
    }
}

/// Exploding ships: capitals burn with secondary blasts, then everything is removed.
fn dying(
    mut commands: Commands,
    time: Res<Time>,
    mut rng: ResMut<WRng>,
    cache: Res<TargetCache>,
    mut q: Query<(Entity, &mut Dying, &Ship, &Transform, &Hittable, Option<&mut Armament>, Has<JumpedOut>, Option<&HullBoxes>)>,
    mut explode: MessageWriter<ExplodeMsg>,
    mut sfx: MessageWriter<SfxMsg>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    let ear = cache.player.map(|p| p.1);
    for (e, mut d, ship, tf, hit, arm, jumped, hull) in &mut q {
        d.t -= dt;
        if ship.capital() && !jumped {
            if let Some(mut arm) = arm {
                arm.boom_t -= dt;
                if arm.boom_t <= 0.0 && d.t > 0.0 {
                    arm.boom_t = 0.13;
                    // anywhere on the model's hull (saucer, nacelles, prow), not only in the core box
                    let (pick, r) = (rng.f(), Vec3::new(rng.f(), rng.f(), rng.f()));
                    let local = hull.and_then(|h| h.0.random_point(pick, r)).unwrap_or_else(|| {
                        let h = hit.half_extents.unwrap_or(Vec3::splat(hit.radius * 0.5));
                        h * (r * 2.0 - Vec3::ONE)
                    });
                    explode.write(ExplodeMsg { pos: tf.translation + tf.rotation * local, size: rng.range(1.5, 3.5) });
                }
            }
            if d.t <= 0.0 {
                explode.write(ExplodeMsg { pos: tf.translation, size: 6.0 });
                if ear.is_none_or(|p| p.distance_squared(tf.translation) < 5000.0 * 5000.0) {
                    sfx.write(SfxMsg::Explosion { size: 6.0 });
                }
            }
        }
        if d.t <= 0.0 {
            commands.entity(e).try_despawn();
        }
    }
}

fn team_idx(t: Team) -> usize {
    match t {
        Team::Union => 0,
        Team::Aszendenz => 1,
        Team::Neutral => 2,
    }
}

/// Closest point of the segment a-b to `c`, if it lies within `r`.
fn seg_hit(a: Vec3, b: Vec3, c: Vec3, r: f32) -> Option<Vec3> {
    let (d2, p) = seg_point(a, b, c);
    (d2 < r * r).then_some(p)
}
