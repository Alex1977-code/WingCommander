//! Graphics (owner: render agent): the main camera (HDR, bloom, ACES, DLSS / TAA / FXAA), the camera rig
//! (cockpit, chase, menu orbit, shake, speed FOV) and the procedural space environment of each mission:
//! a CPU-baked sky cubemap (nebula, Milky Way, stars, planet with atmosphere), image based lighting from it,
//! the sun, asteroid fields and the speed dust / impulse streaks around the camera.
//!
//! Light scale: Bevy's default exposure (EV100 9.7, i.e. `NIT` cd/m² show as 1.0) and ACES fitted tonemapping.
//! three.js' ACES pre-scales by 1/0.6 and Bevy's fit does not, so web light values are multiplied by `WEB`.
//! Emissive materials are not exposure-weighted: an emissive of 1.0 is 1.0 on screen, > ~1.2 blooms.

use std::f32::consts::{PI, TAU};
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

use bevy::anti_alias::contrast_adaptive_sharpening::ContrastAdaptiveSharpening;
use bevy::anti_alias::dlss::{Dlss, DlssPerfQualityMode, DlssSuperResolutionFeature, DlssSuperResolutionSupported};
use bevy::anti_alias::fxaa::Fxaa;
use bevy::anti_alias::taa::TemporalAntiAliasing;
use bevy::asset::RenderAssetUsages;
use bevy::camera::visibility::VisibilityRange;
use bevy::camera::{Exposure, Hdr};
use bevy::core_pipeline::prepass::{DepthPrepass, MotionVectorPrepass};
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::light::{GeneratedEnvironmentMapLight, NotShadowCaster, Skybox};
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::post_process::bloom::{Bloom, BloomCompositeMode, BloomPrefilter};
use bevy::prelude::*;
use bevy::render::camera::{MipBias, TemporalJitter};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension};
use bevy::render::view::Msaa;
use bevy::tasks::{futures::check_ready, AsyncComputeTaskPool, Task};

use crate::common::*;
use crate::mission::BayStatus;
use crate::ships::{spawn_ship_model, ShipLibrary, AURORA_BAY};

// ---------- light scale ----------

/// three.js' ACES multiplies the scene by 1/0.6 before the curve; Bevy's ACES fit does not.
const WEB: f32 = 1.0 / 0.6;
/// cd/m² that show as 1.0 at Bevy's default exposure (2^9.7 · 1.2)
const NIT: f32 = 998.1;
const SKY_NITS: f32 = NIT * WEB;
const ENV_NITS: f32 = NIT * WEB;
/// web: DirectionalLight(0xffedd6, 2.4)
const SUN_LUX: f32 = 2.4 * NIT * WEB;

// ---------- environment layout (same as src/env.js) ----------

/// angular radius of the sun's glow (web sprite: 5200 m wide at 28 km)
const SUN_HALF: f32 = 0.0926;
/// distance of the sun sprite from the camera (web: 28 km, inside the far plane)
const SUN_DIST: f32 = 28_000.0;
/// web sun sprite colour (3.2, 2.7, 2.0); the profile in sun_mesh() sets the brightness
const SUN_COLOR: Vec3 = Vec3::new(3.2, 2.7, 2.0);
const PLANET_DIST: f32 = 24_000.0;
const PLANET_R: f32 = 7_000.0;
const CAM_NEAR: f32 = 0.1;
const CAM_FAR: f32 = 150_000.0;
/// sky cubemap face size (SF_SKY_RES overrides); nebula is computed at a quarter of it and upsampled
const SKY_RES: usize = 2048;
/// source cubemap of the image based lighting (power of two, filtered on the GPU)
const ENV_RES: usize = 128;
const DUST_N: usize = 420;
const DUST_BOX: f32 = 700.0;
const STREAK_N: usize = 220;
const STREAK_BOX: f32 = 900.0;

/// Bevy cameras look down -Z, ships fly along +Z.
const FLIP: Quat = Quat::from_xyzw(0.0, 1.0, 0.0, 0.0);

pub struct GraphicsPlugin;

impl Plugin for GraphicsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CameraShake>()
            .init_resource::<SkyInfo>()
            .init_resource::<SkyCache>()
            .init_resource::<Rig>()
            .init_resource::<MenuShipsPending>()
            .insert_resource(RenderTest::from_env())
            .add_message::<CameraCutMsg>()
            .add_systems(Startup, (setup_camera, build_space_assets, prefetch_skies))
            .add_systems(OnEnter(AppState::Menu), enter_menu)
            .add_systems(OnExit(AppState::Menu), exit_menu)
            .add_systems(OnEnter(AppState::Briefing), prefetch_mission_sky)
            .add_systems(OnEnter(AppState::Flight), enter_flight)
            .add_systems(
                Update,
                (apply_quality, update_sky, tumble_asteroids, spawn_menu_ships.run_if(in_state(AppState::Menu))),
            )
            .add_systems(PostUpdate, (camera_rig, follow_camera).chain().in_set(CameraRigSet).before(TransformSystems::Propagate));
    }
}

// ---------- public API ----------

/// PostUpdate set that moves MainCamera (rig + follow). Systems that project to the screen or follow the eye
/// run `.after(CameraRigSet)` (and `.after(TransformSystems::Propagate)` when they read GlobalTransform).
#[derive(SystemSet, Debug, Clone, PartialEq, Eq, Hash)]
pub struct CameraRigSet;

/// Camera shake strength (web `P.shake`): decays by 2.2 per second. Bump it from anywhere, e.g. on hits.
#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct CameraShake(pub f32);

#[allow(dead_code)] // public API, used by other modules
impl CameraShake {
    /// raise the shake to at least `amount`
    pub fn bump(&mut self, amount: f32) {
        self.0 = self.0.max(amount);
    }
    /// add to the shake, capped at `max`
    pub fn add(&mut self, amount: f32, max: f32) {
        self.0 = (self.0 + amount).min(max.max(self.0));
    }
}

/// Send when the camera jumps (autopilot, respawn, cutscene): snaps the rig and clears the DLSS/TAA history.
#[derive(Message, Clone, Copy, Debug, Default)]
pub struct CameraCutMsg;

/// Directions of the current sky (for lens flares, sun glare on the HUD).
#[derive(Resource, Clone, Copy, Debug)]
#[allow(dead_code)] // public API, used by other modules
pub struct SkyInfo {
    /// unit vector towards the sun
    pub sun_dir: Vec3,
    /// unit vector towards the planet's centre, if there is one
    pub planet_dir: Option<Vec3>,
    /// 0 when the planet hides the sun, 1 in plain view
    pub sun_visible: f32,
}

impl Default for SkyInfo {
    fn default() -> Self {
        Self { sun_dir: Vec3::new(0.55, 0.3, 0.78).normalize(), planet_dir: None, sun_visible: 1.0 }
    }
}

/// An asteroid (InMission). `radius` bounds the rock; `ext` are the half axes (world units, rock space)
/// of the ellipsoid used for collisions. flight.rs collides ships with it, weapons may stop shots on it.
#[derive(Component, Clone, Copy, Debug)]
#[allow(dead_code)] // public API, used by other modules
pub struct Asteroid {
    pub radius: f32,
    pub ext: Vec3,
    /// tumble axis and rate (rad/s)
    pub axis: Vec3,
    pub rate: f32,
}

#[allow(dead_code)] // public API, used by other modules
impl Asteroid {
    /// How deep `p` is inside the rock's ellipsoid grown by `margin`, with the outward surface normal there.
    pub fn depth(&self, tf: &Transform, p: Vec3, margin: f32) -> Option<(f32, Vec3)> {
        let r = self.radius + margin;
        if p.distance_squared(tf.translation) > r * r {
            return None;
        }
        let l = tf.rotation.inverse() * (p - tf.translation);
        let e = self.ext + Vec3::splat(margin);
        let k = (l / e).length();
        if k >= 1.0 {
            return None;
        }
        let n = l / (e * e);
        let n = if n.length_squared() < 1e-12 { Vec3::Y } else { n.normalize() };
        Some(((1.0 - k) * e.min_element(), tf.rotation * n))
    }

    /// Distance along the ray (origin `o`, unit direction `d`) to the rock's ellipsoid, within `max_d`.
    pub fn ray(&self, tf: &Transform, o: Vec3, d: Vec3, max_d: f32) -> Option<f32> {
        let ro = o - tf.translation;
        let b0 = ro.dot(d);
        let c0 = ro.length_squared() - self.radius * self.radius;
        if (c0 > 0.0 && b0 > 0.0) || b0 * b0 - c0 < 0.0 {
            return None;
        }
        let inv = tf.rotation.inverse();
        let lo = inv * ro / self.ext;
        let ld = inv * d / self.ext;
        let (a, b, c) = (ld.length_squared(), lo.dot(ld), lo.length_squared() - 1.0);
        let disc = b * b - a * c;
        if disc < 0.0 {
            return None;
        }
        let t = (-b - disc.sqrt()) / a;
        let t = if t >= 0.0 { t } else if c < 0.0 { 0.0 } else { return None };
        (t <= max_d).then_some(t)
    }
}

/// Everything of the menu backdrop (carrier, fighters, lights); despawned when the menu closes.
#[derive(Component, Default)]
pub struct MenuScene;

/// Pilot eye point in ship space (+Z forward), as in the web version.
pub fn eye_offset(kind: &str) -> Vec3 {
    match kind {
        "sperber" => Vec3::new(0.0, 1.15, 1.6),
        "falke" => Vec3::new(0.0, 1.25, 1.8),
        "greif" => Vec3::new(0.0, 1.4, 2.0),
        _ => Vec3::new(0.0, 1.2, 1.7),
    }
}

/// Spawns `count` asteroids around `center` (see src/env.js createAsteroids). Deterministic for a `seed`.
pub fn spawn_asteroid_field(commands: &mut Commands, rocks: &SpaceAssets, center: Vec3, count: usize, spread: f32, seed: u32) {
    let mut rng = Rng::new(seed);
    for i in 0..count {
        let r = 18.0 + rng.f().powf(2.2) * 150.0;
        let shape = &rocks.rocks[i % rocks.rocks.len()];
        let u = rng.f() * 2.0 - 1.0;
        let th = rng.f() * TAU;
        let s = (1.0 - u * u).sqrt();
        let d = (0.25 + rng.f() * 0.75) * spread;
        let pos = center + Vec3::new(s * th.cos() * d, u * d * 0.45, s * th.sin() * d);
        let rot = random_quat(&mut rng);
        let rock = Asteroid { radius: r * shape.bound, ext: shape.ext * r, axis: rng.dir(), rate: (rng.f() - 0.5) * 0.12 };
        let near = r * 14.0;
        let far = r * 160.0;
        commands
            .spawn((rock, InMission, Transform { translation: pos, rotation: rot, scale: Vec3::splat(r) }, Visibility::default(), Name::new("Asteroid")))
            .with_children(|p| {
                p.spawn((
                    Mesh3d(shape.hi.clone()),
                    MeshMaterial3d(rocks.rock_mat.clone()),
                    VisibilityRange { start_margin: 0.0..0.0, end_margin: near * 0.92..near * 1.08, use_aabb: false },
                ));
                p.spawn((
                    Mesh3d(shape.lo.clone()),
                    MeshMaterial3d(rocks.rock_mat.clone()),
                    VisibilityRange { start_margin: near * 0.92..near * 1.08, end_margin: far * 0.9..far, use_aabb: false },
                    NotShadowCaster,
                ));
            });
    }
}

// ---------- test hooks (env vars, harmless otherwise) ----------

/// SF_TEST_SPEED=<m/s>: pretend the player flies that fast (dust, streaks, FOV);
/// SF_TEST_ROCKS=<n>: an asteroid field 900 m ahead of the start; SF_SKY_RES=<n>: sky face size.
#[derive(Resource, Clone, Copy, Debug)]
struct RenderTest {
    speed: Option<f32>,
    rocks: Option<usize>,
    sky_res: usize,
}

impl RenderTest {
    fn from_env() -> Self {
        let num = |k: &str| std::env::var(k).ok().and_then(|s| s.parse::<f32>().ok());
        Self {
            speed: num("SF_TEST_SPEED"),
            rocks: num("SF_TEST_ROCKS").map(|n| n as usize),
            sky_res: num("SF_SKY_RES").map_or(SKY_RES, |n| (n as usize).clamp(256, 4096)),
        }
    }
}

// ---------- camera & anti-aliasing ----------

fn setup_camera(mut commands: Commands, dlss: Option<Res<DlssSuperResolutionSupported>>, mut avail: ResMut<DlssAvailable>) {
    avail.0 = dlss.is_some();
    info!("DLSS Super Resolution {}", if avail.0 { "verfügbar" } else { "nicht verfügbar, TAA als Ersatz" });
    commands.spawn((
        Name::new("Hauptkamera"),
        Camera3d::default(),
        Camera { clear_color: ClearColorConfig::Custom(Color::BLACK), ..default() },
        Hdr,
        MainCamera,
        Projection::Perspective(PerspectiveProjection { fov: 62f32.to_radians(), near: CAM_NEAR, far: CAM_FAR, ..default() }),
        Tonemapping::AcesFitted,
        Exposure::BLENDER,
        Msaa::Off,
        AmbientLight { color: Color::BLACK, brightness: 0.0, affects_lightmapped_meshes: true },
        Skybox { image: None, brightness: 0.0, rotation: Quat::IDENTITY },
        Transform::from_xyz(390.0, 70.0, 60.0).looking_at(Vec3::new(30.0, 8.0, 40.0), Vec3::Y),
    ));
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum AaMode {
    Dlss(Upscaling),
    Taa,
    Fxaa,
}

fn aa_mode(up: Upscaling, dlss: bool) -> AaMode {
    match up {
        Upscaling::Fxaa => AaMode::Fxaa,
        Upscaling::Taa => AaMode::Taa,
        u if dlss => AaMode::Dlss(u),
        _ => AaMode::Taa,
    }
}

fn dlss_quality(u: Upscaling) -> DlssPerfQualityMode {
    match u {
        Upscaling::Dlaa => DlssPerfQualityMode::Dlaa,
        Upscaling::DlssQuality => DlssPerfQualityMode::Quality,
        Upscaling::DlssBalanced => DlssPerfQualityMode::Balanced,
        Upscaling::DlssPerformance => DlssPerfQualityMode::Performance,
        Upscaling::DlssUltraPerformance => DlssPerfQualityMode::UltraPerformance,
        _ => DlssPerfQualityMode::Auto,
    }
}

/// soft glow of HDR emitters only: the sky, planet and stars stay below the threshold (as in src/post.js)
fn bloom() -> Bloom {
    Bloom {
        intensity: 0.22,
        low_frequency_boost: 0.6,
        prefilter: BloomPrefilter { threshold: 1.1, threshold_softness: 0.35 },
        composite_mode: BloomCompositeMode::Additive,
        ..Bloom::NATURAL
    }
}

/// Applies Settings.upscaling / Settings.bloom to the camera whenever they change.
fn apply_quality(
    mut commands: Commands,
    settings: Res<Settings>,
    avail: Res<DlssAvailable>,
    cam: Query<Entity, With<MainCamera>>,
    mut applied: Local<Option<(AaMode, bool)>>,
) {
    let Ok(cam) = cam.single() else { return };
    let mode = aa_mode(settings.upscaling, avail.0);
    if *applied == Some((mode, settings.bloom)) {
        return;
    }
    let mut ec = commands.entity(cam);
    if applied.map(|a| a.0) != Some(mode) {
        // temporal upscalers bring their own jitter / mip bias / motion vectors: clear all of it first
        ec.remove::<(Dlss, TemporalAntiAliasing, Fxaa, ContrastAdaptiveSharpening, TemporalJitter, MipBias, MotionVectorPrepass, DepthPrepass)>();
        match mode {
            AaMode::Dlss(u) => {
                ec.insert((
                    Dlss::<DlssSuperResolutionFeature> { perf_quality_mode: dlss_quality(u), reset: true, ..default() },
                    ContrastAdaptiveSharpening { enabled: true, sharpening_strength: 0.25, denoise: false },
                    Msaa::Off,
                ));
            }
            AaMode::Taa => {
                ec.insert((
                    TemporalAntiAliasing { reset: true },
                    ContrastAdaptiveSharpening { enabled: true, sharpening_strength: 0.35, denoise: false },
                    Msaa::Off,
                ));
            }
            AaMode::Fxaa => {
                ec.insert((Fxaa::default(), Msaa::Off));
            }
        }
        info!("Kantenglättung: {:?}", mode);
    }
    if settings.bloom {
        ec.insert(bloom());
    } else {
        ec.remove::<Bloom>();
    }
    *applied = Some((mode, settings.bloom));
}

// ---------- camera rig ----------

#[derive(Resource)]
struct Rig {
    /// smoothed ship attitude the camera follows
    q: Quat,
    /// current vertical FOV (degrees)
    fov: f32,
    view: Option<View>,
    player: Option<Entity>,
    state: Option<AppState>,
    cut: bool,
    menu_t: f32,
    shake_t: f32,
    cockpit: bool,
    /// player and cockpit flag the own hull's visibility was last set for
    hull: Option<(Entity, bool)>,
}

impl Default for Rig {
    fn default() -> Self {
        Self { q: Quat::IDENTITY, fov: 62.0, view: None, player: None, state: None, cut: true, menu_t: 0.0, shake_t: 0.0, cockpit: false, hull: None }
    }
}

type PlayerItem<'a> = (Entity, &'a Transform, &'a Ship, Option<&'a Children>, Has<Dying>);

#[allow(clippy::too_many_arguments)]
fn camera_rig(
    time: Res<Time>,
    state: Res<State<AppState>>,
    settings: Res<Settings>,
    test: Res<RenderTest>,
    mut rig: ResMut<Rig>,
    mut shake: ResMut<CameraShake>,
    mut cuts: MessageReader<CameraCutMsg>,
    bay: Option<Res<BayStatus>>,
    players: Query<PlayerItem, (With<Player>, Without<MainCamera>)>,
    mut bodies: Query<&mut Visibility, With<ShipBody>>,
    mut cam: Query<(&mut Transform, &mut Projection, Option<&mut Dlss>, Option<&mut TemporalAntiAliasing>), With<MainCamera>>,
) {
    let Ok((mut ct, mut proj, dlss, taa)) = cam.single_mut() else { return };
    let dt = time.delta_secs().min(0.1);
    let st = *state.get();
    let cut_msg = cuts.read().count() > 0;
    let mut cut = std::mem::take(&mut rig.cut) || cut_msg;
    if rig.state != Some(st) {
        rig.state = Some(st);
        cut = true;
    }
    let aspect = match &*proj {
        Projection::Perspective(p) => p.aspect_ratio.max(0.1),
        _ => 16.0 / 9.0,
    };
    // wide screens: cap the horizontal field of view, the vertical one follows the aspect (web capV)
    let cap_v = |h_deg: f32| (2.0 * ((h_deg.to_radians() * 0.5).tan() / aspect).atan()).to_degrees();

    let player = if st == AppState::Flight { players.iter().next() } else { None };
    let mut target_fov = 62.0;
    rig.cockpit = false;
    match player {
        Some((e, pt, ship, children, dying)) => {
            if rig.player != Some(e) {
                rig.player = Some(e);
                cut = true;
            }
            if rig.view != Some(settings.view) {
                rig.view = Some(settings.view);
                cut = true;
            }
            let boost = ship.def.boost.unwrap_or(ship.def.speed * 1.5).max(1.0);
            let speed = test.speed.unwrap_or(ship.speed);
            let sr = (speed / boost).min(1.0);
            let ir = ((speed - boost) / (IMPULSE_SPEED - boost).max(1.0)).clamp(0.0, 1.0);
            let cockpit = settings.view == View::Cockpit && !dying;
            rig.cockpit = cockpit;
            if dying {
                // the camera lets go of the wreck: drift back and keep it in view
                rig.hull = None;
                let goal = pt.translation + rig.q * Vec3::new(0.0, 14.0, -70.0);
                ct.translation = ct.translation.lerp(goal, 1.0 - (-dt * 1.2).exp());
                let look = Transform::from_translation(ct.translation).looking_at(pt.translation, rig.q * Vec3::Y);
                ct.rotation = ct.rotation.slerp(look.rotation, 1.0 - (-dt * 4.0).exp());
                target_fov = rig.fov;
            } else if cockpit {
                // pilot's eye: locked to the ship, slight head lag, horizon leans into turns
                rig.q = if cut { pt.rotation } else { rig.q.slerp(pt.rotation, 1.0 - (-dt * 22.0).exp()) };
                ct.translation = pt.translation + pt.rotation * eye_offset(&ship.kind);
                ct.rotation = rig.q * Quat::from_rotation_z(ship.bank * 0.45) * FLIP;
                target_fov = cap_v(100.0).min(70.0).round() + sr * 4.0 + ir * 7.0;
            } else {
                rig.q = if cut { pt.rotation } else { rig.q.slerp(pt.rotation, 1.0 - (-dt * 5.5).exp()) };
                let back = 27.0 + sr * 9.0 + ir * 5.0;
                ct.translation = pt.translation + rig.q * Vec3::new(0.0, 7.5, -back);
                // in the hangar tube (landing, parked) the camera stays inside the tube, not in the hull
                if let Some(c) = bay.as_ref().and_then(|b| b.carrier) {
                    ct.translation = keep_in_bay(&c, pt.translation, ct.translation);
                }
                ct.rotation = rig.q * FLIP;
                target_fov = cap_v(104.0).min(60.0) + sr * 10.0 + ir * 6.0;
            }
            // own hull: hidden in the cockpit view. Only written when the view (or the player) changes, so
            // others may hide it too: weapons.rs hides the dying player's wreck, the ships showcase hook the
            // player. While dying the hull is left alone.
            if !dying
                && let Some(children) = children
                && rig.hull != Some((e, cockpit))
            {
                rig.hull = Some((e, cockpit));
                let vis = if cockpit { Visibility::Hidden } else { Visibility::Inherited };
                for c in children.iter() {
                    if let Ok(mut v) = bodies.get_mut(c) {
                        v.set_if_neq(vis);
                    }
                }
            }
        }
        None => {
            rig.player = None;
            rig.view = None;
            if st == AppState::Menu {
                // slow orbit around the carrier (web attract mode)
                rig.menu_t += dt;
                let a = rig.menu_t * 0.06 + 0.9;
                let orbit = Vec3::new(a.cos() * MENU_ORBIT, 55.0 + (a * 0.7).sin() * 25.0, a.sin() * MENU_ORBIT);
                ct.translation = MENU_FOCUS + orbit;
                ct.look_at(MENU_FOCUS, Vec3::Y);
                // the title menu covers the left ~45 % of the screen: turn the view left so the ships sit
                // at ~42 % right of the centre
                let half_h = (62f32.to_radians() * 0.5).tan() * aspect;
                ct.rotate_local_y((0.42 * half_h).atan());
            } else {
                // briefing, debrief, flight without a pilot: the view drifts slowly (no shake: nothing would
                // take its offset back out again)
                ct.rotate_y(dt * 0.012);
                shake.0 = 0.0;
                target_fov = rig.fov;
            }
        }
    }

    rig.fov = if cut { target_fov } else { rig.fov + (target_fov - rig.fov) * (dt * 4.0).min(1.0) };
    let fov = rig.fov.to_radians();
    if matches!(&*proj, Projection::Perspective(p) if (p.fov - fov).abs() > 1e-5)
        && let Projection::Perspective(p) = &mut *proj
    {
        p.fov = fov;
    }

    if shake.0 > 0.0 {
        shake.0 = (shake.0 - dt * 2.2).max(0.0);
        rig.shake_t += dt;
        let t = rig.shake_t * 24.0;
        let (nx, ny) = (smooth_noise(t), smooth_noise(t + 71.3));
        let amp = shake.0 * 1.6;
        if rig.cockpit {
            // inside the cockpit a translation would only move the cockpit with us: shake the view instead
            let (right, up) = (ct.rotation * Vec3::X, ct.rotation * Vec3::Y);
            ct.translation += (right * nx + up * ny) * amp * 0.08;
            ct.rotation *= Quat::from_euler(EulerRot::XYZ, ny * amp * 0.006, nx * amp * 0.006, 0.0);
        } else {
            let (right, up) = (ct.rotation * Vec3::X, ct.rotation * Vec3::Y);
            ct.translation += (right * nx + up * ny) * amp;
        }
    }

    if cut {
        if let Some(mut d) = dlss {
            d.reset = true;
        }
        if let Some(mut t) = taa {
            t.reset = true;
        }
    }
}

/// Chase camera near the TUS Aurora's hangar: while the ship is in or just in front of the tube, the camera
/// is pulled inside the tube's cross-section (blended over the last 40 m before the mouth) and kept off the
/// back wall, so it never sits inside the hull.
fn keep_in_bay(c: &Transform, ship: Vec3, cam: Vec3) -> Vec3 {
    let b = &AURORA_BAY;
    let inv = c.rotation.inverse();
    let ls = inv * (ship - c.translation);
    if ls.x.abs() > b.hw + 20.0 || (ls.y - b.y).abs() > b.hh + 20.0 || ls.z > b.mouth + 70.0 || ls.z < b.back - 10.0 {
        return cam;
    }
    let lc = inv * (cam - c.translation);
    let k = ((b.mouth + 40.0 - lc.z) / 40.0).clamp(0.0, 1.0);
    if k <= 0.0 {
        return cam;
    }
    let inside = Vec3::new(lc.x.clamp(-(b.hw - 1.5), b.hw - 1.5), lc.y.clamp(b.y - b.hh + 1.2, b.y + b.hh - 1.2), lc.z.max(b.back + 2.0));
    c.translation + c.rotation * lc.lerp(inside, k)
}

/// Dust specks and impulse streaks follow the camera (after the rig moved it).
#[allow(clippy::type_complexity)]
fn follow_camera(
    test: Res<RenderTest>,
    cache: Res<SkyCache>,
    cam: Query<(&Transform, &Projection, &Camera), With<MainCamera>>,
    mut sun: Query<(&mut Transform, &mut Visibility), (With<SunSprite>, Without<MainCamera>, Without<DustSpeck>, Without<Streak>)>,
    players: Query<(&Transform, &Ship), (With<Player>, Without<MainCamera>, Without<DustSpeck>, Without<Streak>, Without<SunSprite>)>,
    mut specks: Query<(&DustSpeck, &mut Transform), (Without<MainCamera>, Without<Streak>)>,
    mut streaks: Query<(&Streak, &mut Transform, &mut Visibility), Without<MainCamera>>,
) {
    let Ok((ct, proj, camera)) = cam.single() else { return };
    let c = ct.translation;
    // the sun sprite: parallel to the image plane (round anywhere on screen), constant angular size
    if let Ok((mut st, mut sv)) = sun.single_mut() {
        match cache.shown_info {
            Some(info) => {
                st.translation = c + info.sun_dir * SUN_DIST;
                st.rotation = ct.rotation;
                st.scale = Vec3::splat(SUN_DIST * SUN_HALF.tan());
                sv.set_if_neq(Visibility::Inherited);
            }
            None => {
                sv.set_if_neq(Visibility::Hidden);
            }
        }
    }
    if specks.is_empty() && streaks.is_empty() {
        return;
    }
    let fwd_c = ct.rotation * Vec3::NEG_Z;
    let fov = match proj {
        Projection::Perspective(p) => p.fov,
        _ => 1.0,
    };
    let height = camera.physical_viewport_size().map_or(1080.0, |s| s.y.max(1) as f32);
    // world size of one pixel at distance 1
    let px = 2.0 * (fov * 0.5).tan() / height;
    let vel = players.iter().next().map_or(Vec3::ZERO, |(t, s)| fwd(t) * test.speed.unwrap_or(s.speed));
    let spd = vel.length();
    let hidden = c - fwd_c * 5000.0;

    let speck_fade = 1.0 - smoothstep(700.0, 1300.0, spd);
    for (s, mut t) in &mut specks {
        let rel = wrap(s.0 - c, DUST_BOX) - Vec3::splat(DUST_BOX * 0.5);
        let depth = rel.dot(fwd_c);
        let fade = smoothstep(350.0, 120.0, rel.length()) * smoothstep(4.0, 30.0, depth) * speck_fade;
        if fade < 0.02 {
            t.translation = hidden;
            continue;
        }
        let size_px = (260.0 / depth.max(1.0)).clamp(1.0, 5.0);
        t.translation = c + rel;
        t.scale = Vec3::splat(0.5 * size_px * depth * px * fade);
    }

    let on = spd > 700.0;
    let vis = if on { Visibility::Inherited } else { Visibility::Hidden };
    for (_, _, mut v) in &mut streaks {
        v.set_if_neq(vis);
    }
    if !on {
        return;
    }
    let dir = vel / spd;
    let rot = Quat::from_rotation_arc(Vec3::Z, dir);
    let len = spd * 0.05;
    let streak_fade = smoothstep(700.0, 1700.0, spd);
    for (s, mut t, _) in &mut streaks {
        let rel = wrap(s.0 - c, STREAK_BOX) - Vec3::splat(STREAK_BOX * 0.5);
        let depth = rel.dot(fwd_c);
        let fade = smoothstep(450.0, 160.0, rel.length()) * smoothstep(10.0, 60.0, depth) * streak_fade;
        if fade < 0.02 {
            t.translation = hidden;
            continue;
        }
        let w = 0.6 * depth * px * fade;
        t.translation = c + rel;
        t.rotation = rot;
        t.scale = Vec3::new(w, w, len);
    }
}

// ---------- space environment entities ----------

#[derive(Component)]
struct DustSpeck(Vec3);

#[derive(Component)]
struct Streak(Vec3);

pub struct RockShape {
    hi: Handle<Mesh>,
    lo: Handle<Mesh>,
    /// half axes of the unit rock
    ext: Vec3,
    /// bounding radius of the unit rock
    bound: f32,
}

/// Meshes, materials and textures of the environment, built once at startup.
#[derive(Resource)]
pub struct SpaceAssets {
    pub rocks: Vec<RockShape>,
    pub rock_mat: Handle<StandardMaterial>,
    speck_mesh: Handle<Mesh>,
    speck_mat: Handle<StandardMaterial>,
    streak_mesh: Handle<Mesh>,
    streak_mat: Handle<StandardMaterial>,
    sun_mat: Handle<StandardMaterial>,
}

/// The sun's glow: an unlit additive disc kept parallel to the image plane, so it is round at any FOV and
/// anywhere on screen (a three.js Sprite). It is drawn at SUN_DIST in the camera's direction of the sun, i.e.
/// at infinity like the skybox: the skybox's motion vectors underneath are the right ones for it under
/// TAA/DLSS (additive, it writes neither depth nor motion vectors itself).
#[derive(Component)]
struct SunSprite;

fn build_space_assets(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>) {
    // an icosphere with n subdivisions has 20·(n+1)² triangles: 4500 close up, 720 at a distance
    let rocks = (0..6u32)
        .map(|i| {
            let (hi, ext, bound) = rock_mesh(i + 1, 14);
            let (lo, _, _) = rock_mesh(i + 1, 5);
            RockShape { hi: meshes.add(hi), lo: meshes.add(lo), ext, bound }
        })
        .collect();
    let rock_mat = mats.add(StandardMaterial {
        base_color: Color::WHITE,
        perceptual_roughness: 0.96,
        metallic: 0.03,
        reflectance: 0.3,
        ..default()
    });
    let speck_mat = mats.add(StandardMaterial { base_color: Color::LinearRgba(LinearRgba::rgb(0.6, 0.76, 0.98)), unlit: true, ..default() });
    let streak_mat = mats.add(StandardMaterial {
        base_color: Color::LinearRgba(LinearRgba::rgb(0.75, 0.96, 1.2)),
        unlit: true,
        cull_mode: None,
        ..default()
    });
    let sun_mat = mats.add(StandardMaterial {
        base_color: Color::BLACK,
        unlit: true,
        alpha_mode: AlphaMode::Add,
        cull_mode: None,
        fog_enabled: false,
        ..default()
    });
    commands.spawn((
        Name::new("Sonnenscheibe"),
        SunSprite,
        Mesh3d(meshes.add(sun_mesh())),
        MeshMaterial3d(sun_mat.clone()),
        Transform::default(),
        Visibility::Hidden,
        NotShadowCaster,
    ));
    commands.insert_resource(SpaceAssets {
        sun_mat,
        rocks,
        rock_mat,
        speck_mesh: meshes.add(Sphere::new(1.0).mesh().ico(1).expect("icosphere")),
        speck_mat,
        streak_mesh: meshes.add(streak_mesh()),
        streak_mat,
    });
}

/// unit disc in the XY plane, vertex colours = the glow's radial profile: a small white-hot core that blooms,
/// a soft halo and a faint wide skirt (the web glow texture's reach, but less flat-white in the middle)
fn sun_mesh() -> Mesh {
    const RINGS: [f32; 16] = [0.0, 0.02, 0.04, 0.06, 0.08, 0.11, 0.15, 0.2, 0.26, 0.33, 0.42, 0.52, 0.64, 0.78, 0.9, 1.0];
    const SEG: usize = 64;
    let glow = |r: f32| {
        let core = smoothstep(0.075, 0.03, r);
        let skirt = 0.25 * (-r * r * 6.0).exp() * smoothstep(1.0, 0.6, r);
        core * 3.0 + 0.9 * (-r * r * 30.0).exp() + skirt
    };
    let mut pos = vec![[0.0f32; 3]];
    let g0 = glow(0.0);
    let mut col = vec![[g0, g0, g0, 1.0]];
    for &r in &RINGS[1..] {
        let g = glow(r);
        for k in 0..SEG {
            let a = k as f32 / SEG as f32 * TAU;
            pos.push([a.cos() * r, a.sin() * r, 0.0]);
            col.push([g, g, g, 1.0]);
        }
    }
    let mut idx: Vec<u16> = Vec::new();
    for k in 0..SEG {
        idx.extend([0, 1 + k as u16, 1 + ((k + 1) % SEG) as u16]);
    }
    for ring in 0..RINGS.len() - 2 {
        let (a, b) = (1 + ring * SEG, 1 + (ring + 1) * SEG);
        for k in 0..SEG {
            let k1 = (k + 1) % SEG;
            idx.extend([(a + k) as u16, (b + k) as u16, (b + k1) as u16, (a + k) as u16, (b + k1) as u16, (a + k1) as u16]);
        }
    }
    let n = pos.len();
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, vec![[0.0, 0.0, 1.0]; n])
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, col)
        .with_inserted_indices(Indices::U16(idx))
}

/// two crossed quads along +Z (0..1), bright head, fading tail
fn streak_mesh() -> Mesh {
    let pos: Vec<[f32; 3]> = vec![
        [-1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 0.0, 1.0],
        [-1.0, 0.0, 1.0],
        [0.0, -1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 1.0, 1.0],
        [0.0, -1.0, 1.0],
    ];
    let nrm: Vec<[f32; 3]> = vec![[0.0, 1.0, 0.0]; 4].into_iter().chain(vec![[1.0, 0.0, 0.0]; 4]).collect();
    let col: Vec<[f32; 4]> = pos.iter().map(|p| if p[2] < 0.5 { [1.0; 4] } else { [0.15, 0.15, 0.15, 1.0] }).collect();
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, nrm)
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, col)
        .with_inserted_indices(Indices::U16(vec![0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]))
}

/// The sun's light for a sky (its glow is the SunSprite); tagged for the menu or the mission.
fn spawn_sun(commands: &mut Commands, sky: &SkyParams, menu: bool) -> SkyInfo {
    let info = sky.info();
    let up = if info.sun_dir.y.abs() > 0.95 { Vec3::Z } else { Vec3::Y };
    let mut light = commands.spawn((
        Name::new("Sonne"),
        DirectionalLight { illuminance: SUN_LUX, color: Color::srgb_u8(0xff, 0xed, 0xd6), shadow_maps_enabled: false, ..default() },
        Transform::default().looking_to(-info.sun_dir, up),
    ));
    if menu {
        light.insert(MenuScene);
    } else {
        light.insert(InMission);
    }
    info
}

fn prefetch_skies(data: Res<GameData>, progress: Res<Progress>, test: Res<RenderTest>, mut cache: ResMut<SkyCache>) {
    cache.res = test.sky_res;
    cache.request(&SkyParams::menu());
    cache.request(&SkyParams::of_mission(data.mission(progress.current)));
}

fn prefetch_mission_sky(data: Res<GameData>, progress: Res<Progress>, mut cache: ResMut<SkyCache>) {
    cache.request(&SkyParams::of_mission(data.mission(progress.current)));
}

#[derive(Resource, Default)]
struct MenuShipsPending(bool);

fn enter_menu(mut commands: Commands, mut cache: ResMut<SkyCache>, mut info: ResMut<SkyInfo>, mut pending: ResMut<MenuShipsPending>, mut rig: ResMut<Rig>) {
    let sky = SkyParams::menu();
    cache.want(&sky);
    *info = spawn_sun(&mut commands, &sky, true);
    // the very first OnEnter(Menu) runs before Startup (no ShipLibrary yet): ships follow in Update
    pending.0 = true;
    rig.cut = true;
    rig.menu_t = 0.0;
}

/// Carrier and fighters of the menu backdrop (needs the ShipLibrary, built at Startup). Visual models only
/// (no Ship/Hittable/InMission): gameplay systems never see them.
fn spawn_menu_ships(mut commands: Commands, mut pending: ResMut<MenuShipsPending>, lib: Res<ShipLibrary>) {
    if !std::mem::take(&mut pending.0) {
        return;
    }
    for (kind, pos) in [("aurora", Vec3::ZERO), ("sperber", MENU_FIGHTERS[0]), ("falke", MENU_FIGHTERS[1]), ("greif", MENU_FIGHTERS[2])] {
        let e = spawn_ship_model(&mut commands, &lib, kind, Transform::from_translation(pos));
        commands.entity(e).insert(MenuScene);
    }
}

/// Menu formation: web startAttract's echelon, moved out past the rim of the native saucer (centre (0, 12, 100),
/// radius ~110, y 3..23) and lifted clear of it, so the carrier never swallows it
const MENU_FIGHTERS: [Vec3; 3] = [Vec3::new(135.0, 40.0, 150.0), Vec3::new(155.0, 33.0, 124.0), Vec3::new(175.0, 26.0, 98.0)];
/// what the menu orbit looks at: between the carrier and its escort
const MENU_FOCUS: Vec3 = Vec3::new(60.0, 24.0, 90.0);
/// distance of the menu orbit from MENU_FOCUS
const MENU_ORBIT: f32 = 320.0;

fn exit_menu(mut commands: Commands, q: Query<Entity, With<MenuScene>>, mut pending: ResMut<MenuShipsPending>) {
    pending.0 = false;
    for e in &q {
        commands.entity(e).despawn();
    }
}

#[allow(clippy::too_many_arguments)]
fn enter_flight(
    mut commands: Commands,
    data: Res<GameData>,
    progress: Res<Progress>,
    assets: Res<SpaceAssets>,
    test: Res<RenderTest>,
    mut cache: ResMut<SkyCache>,
    mut info: ResMut<SkyInfo>,
    mut rig: ResMut<Rig>,
) {
    let idx = progress.current;
    let m = data.mission(idx);
    let sky = SkyParams::of_mission(m);
    cache.want(&sky);
    *info = spawn_sun(&mut commands, &sky, false);
    rig.cut = true;

    // speed dust and impulse streaks: fixed specks in a box that wraps around the camera
    let mut rng = Rng::new(0x5eed_0000 ^ idx as u32);
    for _ in 0..DUST_N {
        let base = Vec3::new(rng.f(), rng.f(), rng.f()) * DUST_BOX;
        commands.spawn((
            DustSpeck(base),
            InMission,
            Mesh3d(assets.speck_mesh.clone()),
            MeshMaterial3d(assets.speck_mat.clone()),
            Transform::from_translation(Vec3::splat(-1e5)).with_scale(Vec3::splat(0.05)),
            NotShadowCaster,
        ));
    }
    for _ in 0..STREAK_N {
        let base = Vec3::new(rng.f(), rng.f(), rng.f()) * STREAK_BOX;
        commands.spawn((
            Streak(base),
            InMission,
            Mesh3d(assets.streak_mesh.clone()),
            MeshMaterial3d(assets.streak_mat.clone()),
            Transform::from_translation(Vec3::splat(-1e5)).with_scale(Vec3::splat(0.05)),
            Visibility::Hidden,
            NotShadowCaster,
        ));
    }

    // asteroid fields of the nav points
    for (ni, nav) in m.navs.iter().enumerate() {
        let seed = (idx as u32).wrapping_mul(7919) ^ (ni as u32).wrapping_mul(104_729) ^ 0xa57e;
        if let Some(n) = nav.extra.get("asteroids").and_then(|v| v.as_u64()) {
            spawn_asteroid_field(&mut commands, &assets, Vec3::from(nav.pos), n as usize, 1500.0, seed);
        }
        if let Some(f) = nav.extra.get("field") {
            let at = f.get("at").and_then(json_vec3).unwrap_or(Vec3::from(nav.pos));
            let n = f.get("n").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            let spread = f.get("spread").and_then(|v| v.as_f64()).unwrap_or(1500.0) as f32;
            spawn_asteroid_field(&mut commands, &assets, at, n, spread, seed ^ 0xf1e1d);
        }
    }
    if let Some(n) = test.rocks {
        spawn_asteroid_field(&mut commands, &assets, Vec3::new(0.0, 0.0, 900.0), n, 500.0, 7);
    }
}

fn tumble_asteroids(time: Res<Time>, paused: Res<Paused>, mut q: Query<(&Asteroid, &mut Transform)>) {
    if paused.0 {
        return;
    }
    let dt = time.delta_secs();
    for (a, mut t) in &mut q {
        t.rotation = (Quat::from_axis_angle(a.axis, a.rate * dt) * t.rotation).normalize();
    }
}

// ---------- sky parameters ----------

/// A mission's sky (campaign.json "sky", see src/env.js createEnvironment). Colours are linear.
#[derive(Clone, Debug)]
pub struct SkyParams {
    pub a: Vec3,
    pub b: Vec3,
    pub seed: f32,
    pub planet: Option<(Vec3, Vec3)>,
    pub planet_dir: Vec3,
    pub sun_dir: Vec3,
}

impl SkyParams {
    pub fn from_json(v: Option<&serde_json::Value>) -> Self {
        let get = |k: &str| v.and_then(|v| v.get(k));
        let col = |k: &str, d: &str| linear_hex(get(k).and_then(|c| c.as_str()).unwrap_or(d));
        let planet = match get("planet") {
            Some(serde_json::Value::Array(p)) if p.len() >= 2 => Some((
                linear_hex(p[0].as_str().unwrap_or("#31506b")),
                linear_hex(p[1].as_str().unwrap_or("#c9a37a")),
            )),
            Some(serde_json::Value::Bool(false)) | Some(serde_json::Value::Null) => None,
            Some(_) | None => Some((linear_hex("#31506b"), linear_hex("#c9a37a"))),
        };
        Self {
            a: col("a", "#2b5fff"),
            b: col("b", "#b03cff"),
            seed: get("seed").and_then(|s| s.as_f64()).unwrap_or(1.0) as f32,
            planet,
            planet_dir: get("planetDir").and_then(json_vec3).unwrap_or(Vec3::new(-0.6, -0.25, 0.75)).normalize_or(Vec3::Z),
            sun_dir: get("sun").and_then(json_vec3).unwrap_or(Vec3::new(0.55, 0.3, 0.78)).normalize_or(Vec3::Y),
        }
    }

    pub fn of_mission(m: &Mission) -> Self {
        Self::from_json(m.extra.get("sky"))
    }

    /// the menu backdrop's sky (web startAttract)
    pub fn menu() -> Self {
        Self::from_json(Some(&serde_json::json!({
            "a": "#2456ff", "b": "#b03cff", "seed": 2.2, "planet": ["#27475f", "#d1a877"], "planetDir": [-0.75, -0.15, 0.4]
        })))
    }

    fn key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        let mut f = |v: f32| v.to_bits().hash(&mut h);
        for v in [self.a, self.b, self.planet_dir, self.sun_dir] {
            v.to_array().into_iter().for_each(&mut f);
        }
        f(self.seed);
        if let Some((c1, c2)) = self.planet {
            c1.to_array().into_iter().chain(c2.to_array()).for_each(&mut f);
        }
        h.finish()
    }

    fn planet_angle() -> f32 {
        (PLANET_R / PLANET_DIST).asin()
    }

    fn info(&self) -> SkyInfo {
        let sun_visible = if self.planet.is_some() {
            let a = self.planet_dir.dot(self.sun_dir).clamp(-1.0, 1.0).acos();
            let p = Self::planet_angle();
            smoothstep(p - 0.02, p + 0.06, a)
        } else {
            1.0
        };
        SkyInfo { sun_dir: self.sun_dir, planet_dir: self.planet.map(|_| self.planet_dir), sun_visible }
    }
}

fn linear_hex(s: &str) -> Vec3 {
    let c = Srgba::hex(s).unwrap_or(Srgba::WHITE);
    let l = LinearRgba::from(c);
    Vec3::new(l.red, l.green, l.blue)
}

fn json_vec3(v: &serde_json::Value) -> Option<Vec3> {
    let a = v.as_array()?;
    Some(Vec3::new(a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32, a.get(2)?.as_f64()? as f32))
}

// ---------- sky cache: bakes run in the background, finished skies are kept for reuse ----------

struct SkyBake {
    key: u64,
    sky: Image,
    env: Image,
    ambient: Vec3,
    info: SkyInfo,
}

struct SkyEntry {
    key: u64,
    sky: Handle<Image>,
    env: Handle<Image>,
    ambient: Vec3,
    /// sun direction and eclipse of this sky (for the live sun sprite)
    info: SkyInfo,
}

#[derive(Resource, Default)]
struct SkyCache {
    res: usize,
    ready: Vec<SkyEntry>,
    running: Option<(u64, Task<SkyBake>)>,
    queue: Vec<SkyParams>,
    wanted: Option<u64>,
    shown: Option<u64>,
    /// sun of the sky on screen
    shown_info: Option<SkyInfo>,
    fade: f32,
}

impl SkyCache {
    fn known(&self, key: u64) -> bool {
        self.ready.iter().any(|e| e.key == key)
            || self.running.as_ref().is_some_and(|r| r.0 == key)
            || self.queue.iter().any(|p| p.key() == key)
    }

    fn request(&mut self, p: &SkyParams) {
        if !self.known(p.key()) {
            self.queue.push(p.clone());
        }
    }

    /// show this sky as soon as it is baked (it jumps the queue)
    fn want(&mut self, p: &SkyParams) {
        let key = p.key();
        self.wanted = Some(key);
        if let Some(i) = self.queue.iter().position(|q| q.key() == key) {
            let q = self.queue.remove(i);
            self.queue.insert(0, q);
        } else if !self.known(key) {
            self.queue.insert(0, p.clone());
        }
    }
}

fn update_sky(
    mut commands: Commands,
    time: Res<Time>,
    mut cache: ResMut<SkyCache>,
    mut images: ResMut<Assets<Image>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    assets: Option<Res<SpaceAssets>>,
    mut sun_k: Local<f32>,
    mut cam: Query<(Entity, &mut Skybox, &mut AmbientLight), With<MainCamera>>,
) {
    let cache = &mut *cache;
    if let Some((key, task)) = cache.running.as_mut()
        && let Some(bake) = check_ready(task)
    {
        let key = *key;
        cache.running = None;
        cache.ready.push(SkyEntry { key, sky: images.add(bake.sky), env: images.add(bake.env), ambient: bake.ambient, info: bake.info });
        debug_assert_eq!(key, bake.key);
        // keep at most two skies (~100 MB each at 2048²; never the one wanted or shown)
        while cache.ready.len() > 2 {
            let Some(i) = cache.ready.iter().position(|e| Some(e.key) != cache.wanted && Some(e.key) != cache.shown) else { break };
            cache.ready.remove(i);
        }
    }
    if cache.running.is_none() && !cache.queue.is_empty() {
        let p = cache.queue.remove(0);
        let res = if cache.res == 0 { SKY_RES } else { cache.res };
        let key = p.key();
        let task = AsyncComputeTaskPool::get().spawn(async move { bake_sky(&p, res) });
        cache.running = Some((key, task));
    }

    let Ok((cam, mut sky, mut ambient)) = cam.single_mut() else { return };
    if let Some(w) = cache.wanted
        && cache.shown != Some(w)
        && let Some(e) = cache.ready.iter().find(|e| e.key == w)
    {
        sky.image = Some(e.sky.clone());
        sky.brightness = 0.0;
        commands.entity(cam).insert(GeneratedEnvironmentMapLight {
            environment_map: e.env.clone(),
            intensity: ENV_NITS,
            rotation: Quat::IDENTITY,
            affects_lightmapped_mesh_diffuse: true,
        });
        ambient.color = Color::LinearRgba(LinearRgba::rgb(e.ambient.x, e.ambient.y, e.ambient.z));
        ambient.brightness = NIT * WEB;
        cache.shown = Some(w);
        cache.shown_info = Some(e.info);
        cache.fade = 0.0;
    }
    if cache.shown.is_some() && cache.fade < 1.0 {
        cache.fade = (cache.fade + time.delta_secs().min(0.1) / 0.6).min(1.0);
        sky.brightness = SKY_NITS * smoothstep(0.0, 1.0, cache.fade);
    }
    // the live sun fades in with its sky, and out behind the (baked) planet
    let k = cache.shown_info.map_or(0.0, |i| i.sun_visible) * smoothstep(0.0, 1.0, cache.fade);
    if (k - *sun_k).abs() > 1e-4
        && let Some(assets) = assets
        && let Some(mut m) = mats.get_mut(&assets.sun_mat)
    {
        *sun_k = k;
        m.base_color = Color::LinearRgba(LinearRgba::rgb(SUN_COLOR.x * k, SUN_COLOR.y * k, SUN_COLOR.z * k));
    }
}

// ---------- sky bake (CPU, multi-threaded; port of the web sky / planet / star shaders) ----------

/// GLSL-style value noise (same hash as src/env.js NOISE)
#[inline]
fn hash(p: Vec3) -> f32 {
    let p = p * 0.318_309_9 + Vec3::splat(0.1);
    let p = (p - p.floor()) * 17.0;
    let v = p.x * p.y * p.z * (p.x + p.y + p.z);
    v - v.floor()
}

#[inline]
fn noise(x: Vec3) -> f32 {
    let i = x.floor();
    let f = x - i;
    let f = f * f * (Vec3::splat(3.0) - 2.0 * f);
    let h = |dx: f32, dy: f32, dz: f32| hash(i + Vec3::new(dx, dy, dz));
    let x00 = lerp(h(0.0, 0.0, 0.0), h(1.0, 0.0, 0.0), f.x);
    let x10 = lerp(h(0.0, 1.0, 0.0), h(1.0, 1.0, 0.0), f.x);
    let x01 = lerp(h(0.0, 0.0, 1.0), h(1.0, 0.0, 1.0), f.x);
    let x11 = lerp(h(0.0, 1.0, 1.0), h(1.0, 1.0, 1.0), f.x);
    lerp(lerp(x00, x10, f.y), lerp(x01, x11, f.y), f.z)
}

#[inline]
fn fbm(mut p: Vec3) -> f32 {
    let (mut a, mut s) = (0.5, 0.0);
    for _ in 0..5 {
        s += a * noise(p);
        p = p * 2.03 + Vec3::splat(7.1);
        a *= 0.5;
    }
    s
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// GLSL smoothstep (edges may be reversed)
#[inline]
fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn wrap(v: Vec3, m: f32) -> Vec3 {
    Vec3::new(v.x.rem_euclid(m), v.y.rem_euclid(m), v.z.rem_euclid(m))
}

/// smooth 1D noise in -1..1
fn smooth_noise(t: f32) -> f32 {
    let i = t.floor();
    let f = t - i;
    let h = |n: f32| {
        let v = (n * 127.1).sin() * 43_758.547;
        (v - v.floor()) * 2.0 - 1.0
    };
    lerp(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f))
}

/// mulberry32, as in the web version
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Self(seed)
    }
    fn f(&mut self) -> f32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let t = self.0;
        let mut r = (t ^ (t >> 15)).wrapping_mul(1 | t);
        r ^= r.wrapping_add((r ^ (r >> 7)).wrapping_mul(61 | r));
        ((r ^ (r >> 14)) as f64 / 4_294_967_296.0) as f32
    }
    fn dir(&mut self) -> Vec3 {
        let u = self.f() * 2.0 - 1.0;
        let th = self.f() * TAU;
        let s = (1.0 - u * u).max(0.0).sqrt();
        Vec3::new(s * th.cos(), u, s * th.sin())
    }
}

fn random_quat(rng: &mut Rng) -> Quat {
    let (u1, u2, u3) = (rng.f(), rng.f() * TAU, rng.f() * TAU);
    let (a, b) = ((1.0 - u1).sqrt(), u1.sqrt());
    Quat::from_xyzw(a * u2.sin(), a * u2.cos(), b * u3.sin(), b * u3.cos()).normalize()
}

/// World direction of a cubemap texel. Bevy samples cubemaps with z negated (left-handed lookup).
#[inline]
fn face_dir(face: usize, u: f32, v: f32) -> Vec3 {
    let l = match face {
        0 => Vec3::new(1.0, -v, -u),
        1 => Vec3::new(-1.0, -v, u),
        2 => Vec3::new(u, 1.0, v),
        3 => Vec3::new(u, -1.0, -v),
        4 => Vec3::new(u, -v, 1.0),
        _ => Vec3::new(-u, -v, -1.0),
    };
    Vec3::new(l.x, l.y, -l.z).normalize()
}

/// (u, v) of a world direction on `face`, if the direction points into that face's half space
#[inline]
fn face_uv(face: usize, w: Vec3) -> Option<(f32, f32)> {
    let l = Vec3::new(w.x, w.y, -w.z);
    let (ma, u, v) = match face {
        0 => (l.x, -l.z, -l.y),
        1 => (-l.x, l.z, -l.y),
        2 => (l.y, l.x, l.z),
        3 => (-l.y, l.x, -l.z),
        4 => (l.z, l.x, -l.y),
        _ => (-l.z, -l.x, -l.y),
    };
    (ma > 1e-4).then(|| (u / ma, v / ma))
}

/// the face a direction falls on and its (u, v)
fn dir_face(w: Vec3) -> (usize, f32, f32) {
    let a = w.abs();
    let face = if a.x >= a.y && a.x >= a.z {
        if w.x > 0.0 { 0 } else { 1 }
    } else if a.y >= a.z {
        if w.y > 0.0 { 2 } else { 3 }
    } else if w.z < 0.0 {
        4
    } else {
        5
    };
    let (u, v) = face_uv(face, w).unwrap_or((0.0, 0.0));
    (face, u, v)
}

/// Runs `f(first_row, rows)` over chunks of `rows_per_job` rows on all cores but two (the game keeps running).
fn par_rows<T: Send>(data: &mut [T], row_len: usize, rows_per_job: usize, f: impl Fn(usize, &mut [T]) + Sync) {
    let jobs = Mutex::new(data.chunks_mut(row_len * rows_per_job).enumerate());
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).saturating_sub(2).max(1);
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| {
                loop {
                    let job = jobs.lock().map(|mut j| j.next()).unwrap_or(None);
                    let Some((i, chunk)) = job else { break };
                    f(i * rows_per_job, chunk);
                }
            });
        }
    });
}

/// galactic plane of a sky (stars bunch along it, the Milky Way band follows it)
fn galaxy_normal(seed: f32) -> Vec3 {
    Vec3::new((seed * 1.31).sin(), (seed * 2.07).cos() * 0.8 + 0.4, (seed * 0.73 + 1.1).sin()).normalize()
}

struct PlanetCtx {
    c1: Vec3,
    c2: Vec3,
    center: Vec3,
    dir: Vec3,
    inv_rot: Quat,
    rocky: bool,
    /// cosine of the planet's angular radius, and of the halo's
    cos_disc: f32,
    cos_halo: f32,
    ang: f32,
    halo_r: f32,
    halo_col: Vec3,
    uz: f32,
}

struct SkyCtx {
    a: Vec3,
    b: Vec3,
    seed: f32,
    g: Vec3,
    c0: Vec3,
    sun: Vec3,
    planet: Option<PlanetCtx>,
}

impl SkyCtx {
    fn new(p: &SkyParams) -> Self {
        let g = galaxy_normal(p.seed);
        let planet = p.planet.map(|(c1, c2)| {
            let rocky = (p.seed.floor() as i32).rem_euclid(3) == 0;
            let hs = if rocky { 1.035 } else { 1.05 };
            let ang = SkyParams::planet_angle();
            let halo_ang = (PLANET_R * hs / PLANET_DIST).asin();
            PlanetCtx {
                c1,
                c2,
                center: p.planet_dir * PLANET_DIST,
                dir: p.planet_dir,
                inv_rot: (Quat::from_rotation_x(0.3) * Quat::from_rotation_z(0.35)).inverse(),
                rocky,
                cos_disc: ang.cos(),
                cos_halo: halo_ang.cos(),
                ang,
                halo_r: PLANET_R * hs,
                halo_col: c2.lerp(linear_hex("#8fb8ff"), 0.55),
                uz: (1.0 - 1.0 / (hs * hs)).sqrt(),
            }
        });
        Self { a: p.a, b: p.b, seed: p.seed, g, c0: g.cross(Vec3::new(0.31, 0.94, 0.12)).normalize(), sun: p.sun_dir, planet }
    }

    /// nebula + Milky Way (web skyMaterial)
    fn nebula(&self, d: Vec3) -> Vec3 {
        let s = self.seed;
        let lat = d.dot(self.g);
        let band = (-lat * lat * 55.0).exp();
        let dust_w = (-lat * lat * 240.0).exp();
        let mut col = Vec3::ZERO;
        // wispy, filamentary gas
        let w = fbm(d * 1.6 + Vec3::splat(s));
        let n = fbm(d * 2.2 + Vec3::splat(s + w * 1.4));
        let cloud = smoothstep(0.42, 0.9, n);
        if cloud > 0.0 {
            let n2 = fbm(d * 4.5 + Vec3::splat(-s + n * 1.7));
            let fil = smoothstep(0.55, 0.75, fbm(d * 9.0 + Vec3::splat(n * 3.0 + s)));
            col = self.a.lerp(self.b, smoothstep(0.3, 0.7, n2)) * (cloud * cloud * (0.38 + 0.3 * fil));
            col *= 0.4 + 0.9 * smoothstep(0.25, 0.75, fbm(d * 7.0 + Vec3::splat(3.0 + s)));
        }
        // galaxy band: diffuse star glow along the plane, a brighter core region, dark dust lanes
        let core = d.dot(self.c0).max(0.0).powi(6);
        let wide = (-lat * lat * 14.0).exp() * core * 0.25;
        if band > 1e-4 || wide > 1e-4 {
            let glow = band * (0.55 + 0.45 * fbm(d * 5.0 + Vec3::splat(s * 2.0))) * (0.35 + core * 1.4) + wide;
            let dust = if dust_w > 1e-4 { smoothstep(0.48, 0.7, fbm(d * 7.5 + Vec3::splat(s * 3.0))) * dust_w } else { 0.0 };
            let milky = Vec3::new(0.075, 0.068, 0.06) * glow * (1.0 - 0.85 * dust);
            col = col * (1.0 - 0.6 * dust * band) + milky;
        }
        col + Vec3::new(0.0025, 0.0035, 0.007)
    }

    /// planet surface colour where the view ray `d` hits it (web planetMaterial)
    fn planet_surface(&self, pl: &PlanetCtx, d: Vec3) -> Vec3 {
        // ray from the origin: nearest intersection with the planet sphere (d is inside the disc)
        let b = d.dot(pl.center);
        let c = pl.center.length_squared() - PLANET_R * PLANET_R;
        let t = b - (b * b - c).max(0.0).sqrt();
        let n = ((d * t - pl.center) / PLANET_R).normalize();
        let p = (pl.inv_rot * n).normalize();
        let s = Vec3::splat(self.seed);
        let (c1, c2) = (pl.c1, pl.c2);
        let mut clouds = 0.0;
        let mut base;
        if !pl.rocky {
            // gas giant: latitude bands bent by turbulence, fine streaks, an oval storm
            let warp = fbm(p * 3.0 + s);
            let lat = p.y + (warp - 0.5) * 0.16 + (fbm(p * 11.0 + s) - 0.5) * 0.035;
            let zones = (lat * 34.0 + fbm(p * 2.0 + s) * 2.5).sin() * 0.5 + 0.5;
            let belts = (lat * 11.0 + self.seed).sin() * 0.5 + 0.5;
            let streak = fbm(Vec3::new(p.x * 5.0, p.y * 52.0, p.z * 5.0) + Vec3::splat(warp * 2.5));
            let t = zones * 0.42 + belts * 0.28 + streak * 0.3;
            base = c1.lerp(c2, smoothstep(0.12, 0.88, t));
            base = base.lerp(c1.lerp(c2, 0.5) * Vec3::new(1.08, 1.04, 1.0), 0.25);
            base *= 0.86 + 0.26 * fbm(p * 18.0 + s);
            base *= lerp(1.0, 0.72, smoothstep(0.62, 0.97, p.y.abs()));
            let sc = Vec3::new(0.62, -0.28, 0.73).normalize();
            let ds = ((p - sc) * Vec3::new(1.0, 2.2, 1.0)).length();
            let storm = smoothstep(0.2, 0.02, ds);
            if storm > 0.0 {
                let swirl = fbm(p * 30.0 + Vec3::splat(ds * 14.0));
                let sc = (c2 * 1.25).lerp(c1 * 0.8 + Vec3::new(0.25, 0.08, 0.04), swirl);
                base = base.lerp(sc, storm * 0.8);
            }
        } else {
            // rocky world: lowlands/highlands, craters, polar ice, thin clouds
            let h = fbm(p * 2.6 + s) + 0.5 * fbm(p * 7.0 - s);
            base = c1.lerp(c2, smoothstep(0.55, 1.05, h));
            base *= 0.75 + 0.4 * fbm(p * 22.0 + s);
            let cr = fbm(p * 13.0 + s * 2.0);
            base *= 1.0 - 0.25 * smoothstep(0.62, 0.7, cr) + 0.15 * smoothstep(0.7, 0.74, cr);
            let ice = smoothstep(0.86, 0.95, p.y.abs() + (fbm(p * 6.0) - 0.5) * 0.15);
            base = base.lerp(Vec3::new(0.6, 0.63, 0.67), ice);
            let cw = fbm(Vec3::new(p.x * 3.0, p.y * 9.0, p.z * 3.0) + Vec3::splat(fbm(p * 3.0 + s) * 2.0 + self.seed * 3.0));
            clouds = smoothstep(0.58, 0.85, cw) * 0.45;
            base = base.lerp(Vec3::new(0.66, 0.68, 0.7), clouds);
        }
        let nl = n.dot(self.sun);
        let day = smoothstep(-0.06, 0.3, nl);
        let mu = n.dot(-d).max(0.0);
        let limb = 0.5 + 0.5 * mu.powf(0.45);
        let mut col = (base * day * limb * 1.2).min(Vec3::splat(0.85));
        // atmosphere: scattering brightens the lit limb and tints the terminator
        let rim = (1.0 - mu).powf(3.5);
        let atm = c2.lerp(Vec3::new(0.45, 0.68, 1.0), 0.55);
        col += atm * (rim * smoothstep(-0.25, 0.35, nl) * 1.1);
        col += Vec3::new(1.0, 0.45, 0.2) * (smoothstep(0.12, 0.0, nl.abs()) * 0.06 * (1.0 - clouds));
        col + base * 0.003
    }

    /// atmosphere halo seen just outside the limb (web haloMaterial: back faces of a larger sphere)
    fn planet_halo(&self, pl: &PlanetCtx, d: Vec3) -> Vec3 {
        let b = d.dot(pl.center);
        let c = pl.center.length_squared() - pl.halo_r * pl.halo_r;
        let disc = b * b - c;
        if disc <= 0.0 {
            return Vec3::ZERO;
        }
        let q = d * (b + disc.sqrt());
        let nq = (q - pl.center) / pl.halo_r;
        let k = (nq.dot(d).abs() / pl.uz).clamp(0.0, 1.0).powf(2.2);
        let lit = smoothstep(-0.35, 0.45, nq.dot(self.sun));
        pl.halo_col * (k * lit * 0.75)
    }

    /// background + planet for one direction; `texel` = angular size of a texel (for an antialiased limb)
    fn sky_color(&self, d: Vec3, neb: Vec3, texel: f32) -> Vec3 {
        let Some(pl) = &self.planet else { return neb };
        let cd = d.dot(pl.dir);
        if cd < pl.cos_halo - texel {
            return neb;
        }
        let ang = cd.clamp(-1.0, 1.0).acos();
        let cov = ((pl.ang - ang) / texel + 0.5).clamp(0.0, 1.0);
        let bg = if cov < 1.0 { neb + self.planet_halo(pl, d) } else { Vec3::ZERO };
        if cov <= 0.0 {
            return bg;
        }
        // on the limb: shade the nearest point just inside the disc
        let dh = if ang > pl.ang - texel {
            let perp = (d - pl.dir * cd).normalize_or(Vec3::X);
            let a = pl.ang - texel * 0.5;
            (pl.dir * a.cos() + perp * a.sin()).normalize()
        } else {
            d
        };
        bg.lerp(self.planet_surface(pl, dh), cov)
    }

    fn behind_planet(&self, d: Vec3) -> bool {
        self.planet.as_ref().is_some_and(|pl| d.dot(pl.dir) > (pl.ang * 1.02).cos().min(pl.cos_disc))
    }
}

#[derive(Clone, Copy)]
struct StarSplat {
    x: f32,
    y: f32,
    inv: f32,
    r: f32,
    col: Vec3,
}

/// Stars with realistic colours (mostly white/yellow, some orange/red, few blue), a steep brightness
/// distribution and a concentration along the galactic plane; returns the splats per face sorted by y.
fn make_stars(ctx: &SkyCtx, res: usize) -> Vec<Vec<StarSplat>> {
    const TEMP: [Vec3; 6] = [
        Vec3::new(1.0, 0.58, 0.36),
        Vec3::new(1.0, 0.76, 0.52),
        Vec3::new(1.0, 0.9, 0.76),
        Vec3::new(1.0, 0.97, 0.92),
        Vec3::new(0.9, 0.94, 1.0),
        Vec3::new(0.7, 0.8, 1.0),
    ];
    const TW: [f32; 6] = [0.12, 0.2, 0.24, 0.22, 0.15, 0.07];
    let g = ctx.g;
    let gu = g.cross(if g.y.abs() < 0.9 { Vec3::Y } else { Vec3::X }).normalize();
    let gv = g.cross(gu);
    let mut rng = Rng::new((ctx.seed * 1000.0) as u32 ^ 0x51a7);
    let scale = res as f32 / 2048.0;
    let mut faces: Vec<Vec<StarSplat>> = vec![Vec::new(); 6];
    // bright catalogue stars plus a dense faint background that makes the Milky Way grainy
    for (count, band_share, faint) in [(9000usize, 0.4f32, false), (18000, 0.6, true)] {
        for _ in 0..count {
            let dir = if rng.f() < band_share {
                let a = rng.f() * TAU;
                let lat = (rng.f() + rng.f() + rng.f() - 1.5) * if faint { 0.11 } else { 0.16 };
                (gu * a.cos() + gv * a.sin() + g * lat).normalize()
            } else {
                rng.dir()
            };
            let mut r = rng.f();
            let mut ti = 0;
            while ti < TW.len() - 1 && r > TW[ti] {
                r -= TW[ti];
                ti += 1;
            }
            if ctx.behind_planet(dir) {
                continue;
            }
            let (peak, sigma) = if faint {
                (0.035 + rng.f() * 0.07, 0.55)
            } else {
                let mag = rng.f().powf(5.5);
                ((0.13 + mag * 0.72) * 1.1, 0.6 + mag * 1.5)
            };
            let sigma = (sigma * scale).max(0.5);
            let col = TEMP[ti] * peak.min(0.92);
            let rad = (sigma * 3.0).ceil();
            for (face, list) in faces.iter_mut().enumerate() {
                let Some((u, v)) = face_uv(face, dir) else { continue };
                let x = (u + 1.0) * 0.5 * res as f32;
                let y = (v + 1.0) * 0.5 * res as f32;
                let lim = res as f32 + rad;
                if x < -rad || y < -rad || x > lim || y > lim {
                    continue;
                }
                list.push(StarSplat { x, y, inv: 1.0 / (2.0 * sigma * sigma), r: rad, col });
            }
        }
    }
    for list in &mut faces {
        list.sort_by(|a, b| a.y.total_cmp(&b.y));
    }
    faces
}

/// linear RGB -> shared-exponent HDR texel (Rgb9e5Ufloat: 9 bit mantissas, 5 bit exponent)
fn rgb9e5(c: Vec3) -> u32 {
    const MAX: f32 = 65_408.0;
    let c = c.clamp(Vec3::ZERO, Vec3::splat(MAX));
    let maxc = c.max_element();
    if maxc < 1e-9 {
        return 0;
    }
    let mut e = (maxc.log2().floor() as i32).max(-16) + 1 + 15;
    let mut denom = 2f32.powi(e - 15 - 9);
    if (maxc / denom + 0.5).floor() >= 512.0 {
        denom *= 2.0;
        e += 1;
    }
    let q = |v: f32| ((v / denom + 0.5).floor() as u32).min(511);
    q(c.x) | (q(c.y) << 9) | (q(c.z) << 18) | ((e.clamp(0, 31) as u32) << 27)
}

/// bilinear lookup in a low resolution face grid
#[inline]
fn sample_grid(grid: &[Vec3], n: usize, face: usize, fx: f32, fy: f32) -> Vec3 {
    let fx = fx.clamp(0.0, (n - 1) as f32);
    let fy = fy.clamp(0.0, (n - 1) as f32);
    let (x0, y0) = (fx as usize, fy as usize);
    let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
    let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
    let base = face * n * n;
    let p = |x: usize, y: usize| grid[base + y * n + x];
    p(x0, y0).lerp(p(x1, y0), tx).lerp(p(x0, y1).lerp(p(x1, y1), tx), ty)
}

fn sample_dir(grid: &[Vec3], n: usize, d: Vec3) -> Vec3 {
    let (face, u, v) = dir_face(d);
    sample_grid(grid, n, face, (u + 1.0) * 0.5 * n as f32 - 0.5, (v + 1.0) * 0.5 * n as f32 - 0.5)
}

/// f32 -> IEEE half (non-negative, finite inputs)
fn f16_bits(x: f32) -> u16 {
    let x = if x.is_finite() { x.clamp(0.0, 65_504.0) } else { 0.0 };
    if x < 6.103_515_6e-5 {
        return (x / 5.960_464_5e-8).round() as u16;
    }
    let b = x.to_bits().wrapping_add(0x1000);
    let e = ((b >> 23) & 0xff) as i32 - 127 + 15;
    if e >= 31 {
        return 0x7bff;
    }
    ((e as u16) << 10) | ((b >> 13) & 0x3ff) as u16
}

fn cube_image(res: usize, data: Vec<u8>, format: TextureFormat, usage: RenderAssetUsages) -> Image {
    let mut img = Image::new(
        Extent3d { width: res as u32, height: res as u32, depth_or_array_layers: 6 },
        TextureDimension::D2,
        data,
        format,
        usage,
    );
    img.texture_view_descriptor = Some(TextureViewDescriptor { dimension: Some(TextureViewDimension::Cube), ..default() });
    img
}

fn bake_sky(p: &SkyParams, res: usize) -> SkyBake {
    let t0 = std::time::Instant::now();
    let ctx = SkyCtx::new(p);
    let nl = (res / 4).max(64);

    // 1. nebula and Milky Way are smooth: computed at a quarter of the resolution
    let mut neb = vec![Vec3::ZERO; 6 * nl * nl];
    par_rows(&mut neb, nl, 4, |row0, rows| {
        for (i, row) in rows.chunks_mut(nl).enumerate() {
            let (face, y) = ((row0 + i) / nl, (row0 + i) % nl);
            let v = (y as f32 + 0.5) / nl as f32 * 2.0 - 1.0;
            for (x, px) in row.iter_mut().enumerate() {
                let u = (x as f32 + 0.5) / nl as f32 * 2.0 - 1.0;
                *px = ctx.nebula(face_dir(face, u, v));
            }
        }
    });

    // 2. full resolution faces: upsampled nebula, planet, stars (HDR, shared exponent). The sun is a live
    //    camera-facing sprite (SunSprite): baked into the cube it would stretch to an oval at wide angles.
    let stars = make_stars(&ctx, res);
    let texel = std::f32::consts::FRAC_PI_2 / res as f32;
    let k = nl as f32 / res as f32;
    let mut data = vec![0u32; 6 * res * res];
    par_rows(&mut data, res, 8, |row0, rows| {
        let mut line = vec![Vec3::ZERO; res];
        for (i, out) in rows.chunks_mut(res).enumerate() {
            let (face, y) = ((row0 + i) / res, (row0 + i) % res);
            let v = (y as f32 + 0.5) / res as f32 * 2.0 - 1.0;
            let fy = (y as f32 + 0.5) * k - 0.5;
            for (x, px) in line.iter_mut().enumerate() {
                let neb = sample_grid(&neb, nl, face, (x as f32 + 0.5) * k - 0.5, fy);
                let u = (x as f32 + 0.5) / res as f32 * 2.0 - 1.0;
                let d = face_dir(face, u, v);
                *px = ctx.sky_color(d, neb, texel);
            }
            let list = &stars[face];
            let yc = y as f32 + 0.5;
            let lo = list.partition_point(|s| s.y < yc - 10.0);
            for s in list[lo..].iter().take_while(|s| s.y <= yc + 10.0) {
                let dy = yc - s.y;
                if dy.abs() > s.r {
                    continue;
                }
                let x0 = (s.x - s.r).floor().max(0.0) as usize;
                let x1 = ((s.x + s.r).ceil().max(0.0) as usize).min(res);
                for (x, px) in line.iter_mut().enumerate().take(x1).skip(x0) {
                    let dx = x as f32 + 0.5 - s.x;
                    *px += s.col * (-(dx * dx + dy * dy) * s.inv).exp();
                }
            }
            for (o, c) in out.iter_mut().zip(&line) {
                *o = rgb9e5(*c);
            }
        }
    });
    let data: Vec<u8> = data.into_iter().flat_map(u32::to_le_bytes).collect();

    // 3. reflection / ambient source: nebula, sun disc and glow, a cool fill opposite the sun,
    //    and half of the web's hemisphere light (the other half is the camera's ambient light)
    let sun = p.sun_dir;
    let hemi_sky = p.a.lerp(Vec3::ONE, 0.3) * (0.65 / PI);
    let hemi_ground = p.b * 0.4 * (0.65 / PI);
    let fill = p.a.lerp(Vec3::new(0.45, 0.75, 1.0), 0.65) * 0.4;
    let mut env = vec![0u8; 6 * ENV_RES * ENV_RES * 8];
    par_rows(&mut env, ENV_RES * 8, 4, |row0, rows| {
        for (i, row) in rows.chunks_mut(ENV_RES * 8).enumerate() {
            let (face, y) = ((row0 + i) / ENV_RES, (row0 + i) % ENV_RES);
            let v = (y as f32 + 0.5) / ENV_RES as f32 * 2.0 - 1.0;
            for (x, o) in row.chunks_exact_mut(8).enumerate() {
                let u = (x as f32 + 0.5) / ENV_RES as f32 * 2.0 - 1.0;
                let d = face_dir(face, u, v);
                let cs = d.dot(sun);
                let mut c = sample_dir(&neb, nl, d);
                // fill sphere in front of the sky (web: radius 26 at distance 40 → 40°)
                c = c.lerp(fill, smoothstep(0.55, 0.95, -cs));
                c += Vec3::new(30.0, 26.0, 20.0) * 0.6 * smoothstep(0.990, 0.993, cs);
                c += Vec3::new(1.5, 1.15, 0.8) * smoothstep(0.94, 0.955, cs);
                c += hemi_ground.lerp(hemi_sky, d.y * 0.5 + 0.5) * 0.5;
                for (j, val) in c.extend(1.0).to_array().into_iter().enumerate() {
                    o[j * 2..j * 2 + 2].copy_from_slice(&f16_bits(val).to_le_bytes());
                }
            }
        }
    });
    let ambient = (hemi_sky + hemi_ground) * 0.25;
    info!("Himmel {}² gebacken in {:.2} s", res, t0.elapsed().as_secs_f32());
    SkyBake {
        key: p.key(),
        sky: cube_image(res, data, TextureFormat::Rgb9e5Ufloat, RenderAssetUsages::RENDER_WORLD),
        // the environment map generator reads the source's size in the main world every frame
        env: cube_image(ENV_RES, env, TextureFormat::Rgba16Float, RenderAssetUsages::all()),
        ambient,
        info: p.info(),
    }
}

// ---------- asteroid meshes (port of src/env.js rockGeometry) ----------

fn hash3(x: f32, y: f32, z: f32) -> f32 {
    let h = (x * 127.1 + y * 311.7 + z * 74.7).sin() * 43_758.547;
    h - h.floor()
}

fn vnoise(x: f32, y: f32, z: f32) -> f32 {
    let (ix, iy, iz) = (x.floor(), y.floor(), z.floor());
    let s = |t: f32| t * t * (3.0 - 2.0 * t);
    let (fx, fy, fz) = (s(x - ix), s(y - iy), s(z - iz));
    let h = |dx: f32, dy: f32, dz: f32| hash3(ix + dx, iy + dy, iz + dz);
    lerp(
        lerp(lerp(h(0., 0., 0.), h(1., 0., 0.), fx), lerp(h(0., 1., 0.), h(1., 1., 0.), fx), fy),
        lerp(lerp(h(0., 0., 1.), h(1., 0., 1.), fx), lerp(h(0., 1., 1.), h(1., 1., 1.), fx), fy),
        fz,
    )
}

fn fbm3(mut x: f32, mut y: f32, mut z: f32, oct: u32) -> f32 {
    let (mut a, mut s) = (0.5, 0.0);
    for _ in 0..oct {
        s += a * vnoise(x, y, z);
        x = x * 2.03 + 7.1;
        y = y * 2.03 + 3.3;
        z = z * 2.03 + 1.7;
        a *= 0.5;
    }
    s
}

/// linear albedo: asteroids are dark (coal-black to dusty brown)
const ROCK_TYPES: [Vec3; 4] = [
    Vec3::new(0.07, 0.066, 0.062),
    Vec3::new(0.15, 0.12, 0.095),
    Vec3::new(0.12, 0.115, 0.11),
    Vec3::new(0.17, 0.12, 0.085),
];

/// Lumpy, cratered rock with baked albedo variation and cavity shading. Returns (mesh, half axes, bound).
fn rock_mesh(seed: u32, detail: u32) -> (Mesh, Vec3, f32) {
    let mut rng = Rng::new(seed.wrapping_mul(9973).wrapping_add(17));
    let mut ico = Sphere::new(1.0).mesh().ico(detail).expect("icosphere");
    ico.remove_attribute(Mesh::ATTRIBUTE_UV_0);
    ico.remove_attribute(Mesh::ATTRIBUTE_NORMAL);
    // shared vertices: smooth normals, no cracks
    let _ = ico.merge_duplicate_vertices();
    let src: Vec<Vec3> = ico.attribute(Mesh::ATTRIBUTE_POSITION).and_then(|a| a.as_float3()).unwrap_or(&[]).iter().map(|p| Vec3::from(*p)).collect();
    let indices = ico.indices().cloned().unwrap_or(Indices::U32(Vec::new()));

    let (sy, sz) = (0.62 + rng.f() * 0.3, 0.75 + rng.f() * 0.35); // elongated, flattened bodies
    let craters: Vec<(Vec3, f32, f32)> = (0..7 + (rng.f() * 8.0) as usize)
        .map(|_| {
            let c = Vec3::new(rng.f() * 2.0 - 1.0, rng.f() * 2.0 - 1.0, rng.f() * 2.0 - 1.0).normalize_or(Vec3::Y);
            (c, 0.1 + rng.f().powf(1.6) * 0.38, 0.08 + rng.f() * 0.13)
        })
        .collect();
    let o = rng.f() * 50.0;
    let mut pos = Vec::with_capacity(src.len());
    let mut hgt = Vec::with_capacity(src.len());
    let mut crat = Vec::with_capacity(src.len());
    for v in &src {
        let v = v.normalize();
        let mut h = (fbm3(v.x * 1.4 + o, v.y * 1.4, v.z * 1.4, 3) - 0.5) * 0.55 // big lumps
            + (fbm3(v.x * 4.0 + o, v.y * 4.0, v.z * 4.0, 4) - 0.5) * 0.16 // knobs and ridges
            + (fbm3(v.x * 13.0 + o, v.y * 13.0, v.z * 13.0, 3) - 0.5) * 0.05; // grit
        let mut cr = 0.0;
        for &(c, r, d) in &craters {
            let x = v.dot(c).min(1.0).acos() / r;
            if x < 1.0 {
                cr += (x * x - 1.0) * d; // bowl
            }
            let q = (x - 1.0) * 3.2;
            cr += (-q * q).exp() * d * 0.35; // raised rim
        }
        h += cr;
        hgt.push(h);
        crat.push(cr);
        let p = v * (1.0 + h);
        pos.push(Vec3::new(p.x, p.y * sy, p.z * sz));
    }
    let ext = pos.iter().fold(Vec3::ZERO, |m, p| m.max(p.abs())) * 0.94;
    let bound = pos.iter().fold(0.0f32, |m, p| m.max(p.length()));
    let t = ROCK_TYPES[seed as usize % ROCK_TYPES.len()];
    let colors: Vec<[f32; 4]> = pos
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let m = 0.78 + 0.44 * fbm3(v.x * 6.0 + o, v.y * 6.0, v.z * 6.0, 4);
            let cav = (0.75 + hgt[i] * 1.6).clamp(0.45, 1.15);
            let rim = 1.0 + crat[i].max(0.0) * 2.5;
            let k = m * cav * rim * if crat[i] < -0.02 { 0.85 } else { 1.0 };
            let tint = 0.94 + 0.12 * vnoise(v.x * 3.0 + o, v.y * 3.0, v.z * 3.0);
            [t.x * k * tint, t.y * k, t.z * k * (2.0 - tint), 1.0]
        })
        .collect();
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos.iter().map(|p| p.to_array()).collect::<Vec<_>>())
        .with_inserted_attribute(Mesh::ATTRIBUTE_COLOR, colors)
        .with_inserted_indices(indices);
    mesh.compute_area_weighted_normals();
    (mesh, ext, bound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cube_faces_round_trip() {
        for face in 0..6 {
            for (u, v) in [(-0.7, 0.3), (0.2, -0.9), (0.0, 0.0)] {
                let d = face_dir(face, u, v);
                let (f, uu, vv) = dir_face(d);
                assert_eq!(f, face);
                assert!((uu - u).abs() < 1e-4 && (vv - v).abs() < 1e-4);
            }
        }
    }

    #[test]
    fn half_floats() {
        assert_eq!(f16_bits(1.0), 0x3c00);
        assert_eq!(f16_bits(0.5), 0x3800);
        assert_eq!(f16_bits(65_504.0), 0x7bff);
    }

    #[test]
    fn shared_exponent() {
        // 1.0 = mantissa 256 at exponent 16 (bias 15, 9 bit mantissa)
        let v = rgb9e5(Vec3::new(1.0, 0.5, 0.0));
        assert_eq!(v & 0x1ff, 256);
        assert_eq!((v >> 9) & 0x1ff, 128);
        assert_eq!(v >> 27, 16);
    }
}
