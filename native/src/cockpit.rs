//! 3D cockpit of a well-used Union fighter (owner: cockpit agent), ported from src/cockpit.js.
//!
//! - wrap-around instrument console with a padded glare shield, canopy frame struts, louvred ribs,
//!   bolted-on stainless instrument pods, cable bundles and conduit
//! - live instruments drawn on the CPU (10-20 Hz): own-ship schematic with shield sectors and hull hits,
//!   3D radar scope, target scan, annunciator panel, seven-segment readouts, LED bars, scrolling log screens
//! - push-buttons, keypad, guarded toggles and master caution that follow the fighter's state
//! - stick and throttle with the pilot's hands, following the inputs
//! - battle damage: displays flicker or die, sparks fly, the canopy cracks
//!
//! The cockpit is a child of the main camera, so it is fixed to the view; the camera rig in render.rs puts the
//! camera at the pilot's eye. It is built in "web metres" and scaled by `SCALE`: bigger and farther away it
//! looks the same, but stays clear of f32 jitter in world space far from the origin (the web version renders it
//! in a separate scene for the same reason).

mod canvas;
mod geom;
mod hands;
mod screens;
mod tex;

use std::collections::HashMap;
use std::f32::consts::{FRAC_PI_2, PI};

use bevy::light::NotShadowCaster;
use bevy::prelude::*;

use crate::common::*;
use crate::flight::Pilot;
use crate::weapons::{PlayerAim, SeekerWarning, WeaponsSet};
use canvas::Rng;
use geom::Geo;
use screens::{Elem, Screens};

/// The cockpit is modelled in web metres and shown this much bigger (see module docs).
const SCALE: f32 = 4.0;
/// Web emissive / light values -> Bevy (three.js' ACES pre-scale, see render.rs)
const WEB: f32 = 1.0 / 0.6;
/// Lumen per web candela at Bevy's default exposure
const CANDELA: f32 = 4.0 * PI * 998.1 * WEB;

pub struct CockpitPlugin;

impl Plugin for CockpitPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CockpitState>()
            .add_systems(Startup, (setup_assets, hands::start_hand_build))
            .add_systems(OnEnter(AppState::Flight), reset_cockpit)
            .add_systems(
                Update,
                (
                    ensure_built,
                    hands::attach_hands,
                    cockpit_events,
                    test_damage,
                    animate_controls,
                    update_lamps,
                    screens::update_screens,
                    update_sparks,
                )
                    .chain()
                    .after(WeaponsSet::Dying)
                    .run_if(in_state(AppState::Flight)),
            )
            .add_systems(PostUpdate, cockpit_visibility.before(TransformSystems::Propagate));
    }
}

// ---------- layout ----------

/// Screen-relative layout: everything is placed in camera space from the view's aspect and base FOV.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub aspect: f32,
    pub fov: f32,
    th: f32,
    /// console radius, height, lean (rad) and vertical offset
    pub r: f32,
    pub h: f32,
    lean: f32,
    panel_y: f32,
    span: f32,
}

impl Layout {
    fn new(aspect: f32, fov_deg: f32) -> Self {
        let half_v = fov_deg.to_radians() * 0.5;
        let th = half_v.tan();
        // on wide screens the vertical field of view is smaller: the console moves a little further away until
        // everything from its top edge (33 % below centre) down to the button rows fits
        let avail = half_v - (0.33 * th).atan();
        let r = 0.62 * (0.4 / avail).max(1.0);
        let (h, lean) = (0.32, -0.21);
        let top = Quat::from_rotation_x(lean) * Vec3::new(0.0, h * 0.5, -r);
        let want_y = -0.33 * th * -top.z;
        let span = (120.0 + aspect * 18.0).min(170.0);
        Self { aspect, fov: fov_deg, th, r, h, lean, panel_y: want_y - top.y, span }
    }
    /// point at screen fraction (fx, fy) and distance d
    fn s(&self, fx: f32, fy: f32, d: f32) -> Vec3 {
        Vec3::new(fx * self.th * self.aspect * d, fy * self.th * d, -d)
    }
    fn panel(&self) -> Mat4 {
        Mat4::from_translation(Vec3::new(0.0, self.panel_y, 0.0)) * Mat4::from_rotation_x(self.lean)
    }
    /// how far a flat part of width `w` must stand off the curved console face to clear it at its edges
    fn flat(&self, w: f32) -> f32 {
        self.r - (self.r * self.r - w * w * 0.25).max(0.0).sqrt()
    }
    /// a spot on the console face at `deg` around the arc, height `y`, `inset` towards the pilot; local +Z faces him
    fn place(&self, deg: f32, y: f32, inset: f32) -> Mat4 {
        let (a, r) = (deg.to_radians(), self.r - inset);
        self.panel() * Mat4::from_translation(Vec3::new(r * a.sin(), y, -r * a.cos())) * Mat4::from_rotation_y(-a)
    }
}

/// Base cockpit FOV for an aspect (same formula as render.rs' camera rig without the speed widening).
fn layout_fov(aspect: f32) -> f32 {
    let cap_v = (2.0 * ((100f32.to_radians() * 0.5).tan() / aspect).atan()).to_degrees();
    cap_v.min(70.0).round()
}

// ---------- materials ----------

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum M {
    Metal,
    Dark,
    Bezel,
    Rubber,
    Chrome,
    Trim,
    Steel,
    SteelDark,
    RedCover,
    Cable(u8),
    Conduit,
    Decal(u8),
    HudEdge,
    Sleeve,
    Cuff,
    Glass,
    Crack,
    Inset,
    ScreenGlass,
}

/// texture tile size (m) of a material: UVs in metres are divided by it
fn tile(m: M) -> f32 {
    match m {
        M::Cable(_) => 0.05,
        M::Conduit => 0.054,
        M::Sleeve => 0.3,
        _ => 0.34,
    }
}

/// Cap colours of the illuminated buttons, keys, LEDs and the master caution.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum CapBase {
    Button,
    Key,
    Led,
    Caution,
}

#[derive(Resource)]
struct CockpitAssets {
    mats: HashMap<M, Handle<StandardMaterial>>,
    /// emissive variants of the caps, created on first use
    lamps: HashMap<(CapBase, [u16; 3]), Handle<StandardMaterial>>,
    bolt: Handle<Mesh>,
    spark: (Handle<Mesh>, Handle<StandardMaterial>),
}

impl CockpitAssets {
    fn mat(&self, m: M) -> Handle<StandardMaterial> {
        self.mats.get(&m).cloned().unwrap_or_default()
    }
    /// cap material lit with web emissive `e` (quantised so only a small palette ever exists)
    fn lamp(&mut self, mats: &mut Assets<StandardMaterial>, base: CapBase, e: [f32; 3]) -> Handle<StandardMaterial> {
        let q = e.map(|v| (v.max(0.0) * 40.0).round() as u16);
        self.lamps
            .entry((base, q))
            .or_insert_with(|| {
                let (col, rough) = match base {
                    CapBase::Button => (0x1d1f22, 0.5),
                    CapBase::Key => (0x2a2c30, 0.6),
                    CapBase::Led => (0x220000, 0.4),
                    CapBase::Caution => (0x401014, 0.4),
                };
                let k = WEB * 0.85 / 40.0;
                mats.add(StandardMaterial {
                    base_color: srgb(col),
                    emissive: LinearRgba::rgb(q[0] as f32 * k, q[1] as f32 * k, q[2] as f32 * k),
                    perceptual_roughness: rough,
                    ..default()
                })
            })
            .clone()
    }
}

fn srgb(c: u32) -> Color {
    Color::srgb_u8((c >> 16) as u8, (c >> 8) as u8, c as u8)
}

fn setup_assets(mut commands: Commands, mut images: ResMut<Assets<Image>>, mut mats: ResMut<Assets<StandardMaterial>>, mut meshes: ResMut<Assets<Mesh>>) {
    let mut add_img = |c: &canvas::Canvas, srgb_data: bool| images.add(c.static_image(srgb_data, true));
    let worn_mat = |imgs: (Handle<Image>, Handle<Image>), tint: Color, metal: f32, rough: f32| StandardMaterial {
        base_color: tint,
        base_color_texture: Some(imgs.0),
        metallic_roughness_texture: Some(imgs.1),
        metallic: metal,
        perceptual_roughness: rough,
        ..default()
    };
    let wp = tex::worn(0x5b626b, 512, 11, true, &["88. GESCHW. · NACHTFALKEN", "WARTUNG 2643-07 ✓", "NICHT BETRETEN"], true, 1.0);
    let wd = tex::worn(0x30353c, 512, 12, false, &[], true, 1.5);
    let wb = tex::worn(0x4a5058, 512, 13, false, &[], false, 1.0);
    let ws = tex::worn(0x3b3a2e, 256, 14, false, &[], false, 1.2);
    let brushed = add_img(&tex::brushed(15), true);
    let mut m = HashMap::new();
    m.insert(M::Metal, mats.add(worn_mat((add_img(&wp.color, true), add_img(&wp.rough, false)), Color::WHITE, 0.55, 0.75)));
    m.insert(M::Dark, mats.add(StandardMaterial { double_sided: true, cull_mode: None, ..worn_mat((add_img(&wd.color, true), add_img(&wd.rough, false)), Color::WHITE, 0.35, 0.85) }));
    m.insert(M::Bezel, mats.add(worn_mat((add_img(&wb.color, true), add_img(&wb.rough, false)), Color::WHITE, 0.6, 0.7)));
    m.insert(M::Sleeve, mats.add(worn_mat((add_img(&ws.color, true), add_img(&ws.rough, false)), srgb(0x9a968a), 0.0, 0.95)));
    let plain = |c: u32, metal: f32, rough: f32| StandardMaterial { base_color: srgb(c), metallic: metal, perceptual_roughness: rough, ..default() };
    m.insert(M::Rubber, mats.add(plain(0x1a1b1d, 0.0, 0.95)));
    m.insert(M::Chrome, mats.add(plain(0x9aa2ab, 0.95, 0.3)));
    m.insert(M::Trim, mats.add(plain(0xc8581a, 0.3, 0.6)));
    m.insert(M::Cuff, mats.add(plain(0x23271f, 0.0, 0.9)));
    m.insert(M::Inset, mats.add(plain(0x0c0d0f, 0.2, 0.6)));
    m.insert(M::Steel, mats.add(StandardMaterial { base_color_texture: Some(brushed.clone()), metallic: 0.75, perceptual_roughness: 0.34, ..default() }));
    m.insert(M::SteelDark, mats.add(StandardMaterial { base_color: srgb(0x6d737a), base_color_texture: Some(brushed), metallic: 0.8, perceptual_roughness: 0.4, ..default() }));
    m.insert(M::RedCover, mats.add(StandardMaterial { base_color: Color::srgba_u8(0xc0, 0x20, 0x1a, 217), metallic: 0.1, perceptual_roughness: 0.35, alpha_mode: AlphaMode::Blend, ..default() }));
    for (i, c) in [0x7a1a14, 0xa8801a, 0x1d1e20, 0x1f3f7a].into_iter().enumerate() {
        let t = add_img(&tex::ribs(c, false), true);
        m.insert(M::Cable(i as u8), mats.add(StandardMaterial { base_color_texture: Some(t), metallic: 0.05, perceptual_roughness: 0.55, ..default() }));
    }
    let t = add_img(&tex::ribs(0x4a4d52, true), true);
    m.insert(M::Conduit, mats.add(StandardMaterial { base_color_texture: Some(t), metallic: 0.6, perceptual_roughness: 0.45, ..default() }));
    for (i, (title, sub, col)) in [("88. GESCHWADER", "NACHTFALKEN", 0xc8581a), ("WARTUNG 2643-07", "TECH. HAUPTFELDW. OKAFOR", 0xd8d0b8), ("⚠ HOCHSPANNUNG", "SCHILDBUS NICHT ÖFFNEN", 0xe0b030)].into_iter().enumerate() {
        let c = tex::decal(title, sub, col, 30 + i as u32);
        let img = images.add(c.static_image(true, false));
        m.insert(M::Decal(i as u8), mats.add(StandardMaterial { base_color_texture: Some(img), alpha_mode: AlphaMode::Mask(0.5), perceptual_roughness: 0.8, ..default() }));
    }
    m.insert(M::HudEdge, mats.add(StandardMaterial { base_color: Color::LinearRgba(LinearRgba::rgb(0.4 * WEB, 1.6 * WEB, 0.8 * WEB)), unlit: true, ..default() }));
    let smudge = images.add(tex::smudges(16).static_image(true, false));
    m.insert(M::Glass, mats.add(StandardMaterial { base_color: Color::linear_rgb(0.1, 0.1, 0.1), base_color_texture: Some(smudge), unlit: true, alpha_mode: AlphaMode::Add, double_sided: true, cull_mode: None, ..default() }));
    // display cover glass: only its reflections show (premultiplied, nearly no base colour)
    m.insert(M::ScreenGlass, mats.add(StandardMaterial { base_color: Color::srgba(0.0, 0.0, 0.0, 0.03), perceptual_roughness: 0.14, reflectance: 0.5, alpha_mode: AlphaMode::Premultiplied, ..default() }));
    let screens = Screens::new(&mut images, &mut mats);
    m.insert(M::Crack, screens.crack_mat.clone());
    let bolt = meshes.add(geom::cylinder(0.0035, 0.0035, 0.003, 6, true).transformed(&Mat4::from_rotation_x(FRAC_PI_2)).to_mesh());
    let spark = (
        meshes.add(geom::sphere(0.0034, 6, 4).to_mesh()),
        mats.add(StandardMaterial { base_color: Color::BLACK, emissive: LinearRgba::rgb(3.0 * WEB, 1.8 * WEB, 0.6 * WEB), unlit: true, ..default() }),
    );
    commands.insert_resource(CockpitAssets { mats: m, lamps: HashMap::new(), bolt, spark });
    commands.insert_resource(screens);
}

// ---------- components ----------

#[derive(Component)]
struct CockpitRoot {
    layout: Layout,
}

#[derive(Component)]
struct StickPivot;

#[derive(Component)]
struct ThrottleLever;

/// a guarded toggle switch: 0 BOOST, 1 AUTO, 2 WAFFE, 3 ECM
#[derive(Component, Clone, Copy)]
enum Toggle {
    Lever(usize),
    Cover(usize),
    Led(usize),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ButtonKind {
    Idle,
    ShieldGen,
    Guns,
    Nav,
    Ecm,
    Missile,
    Boost,
    Comm,
    Auto,
    Hull,
}

/// illuminated push-button in a bank under the displays
#[derive(Component)]
struct Button {
    kind: ButtonKind,
    idx: usize,
    phase: f32,
    bank: Elem,
}

#[derive(Component)]
struct KeyCap {
    phase: f32,
}

#[derive(Component)]
struct CautionCap;

#[derive(Component)]
struct AlarmLight;

#[derive(Component)]
struct ScreenLight;

#[derive(Component)]
struct CanopyGlass;

#[derive(Component)]
struct Spark(usize);

/// where the pilot's hands go (filled in when the hand meshes are ready)
#[derive(Component, Clone, Copy)]
pub enum HandMount {
    Stick,
    Throttle,
}

// ---------- state ----------

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Fail {
    #[default]
    Ok,
    Flicker,
    Dead,
}

/// lamp colours of the annunciator panel; `blink` 0 steady, 1 slow, 2 fast
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum LampCol {
    #[default]
    Off,
    Green,
    Amber,
    Red,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Lamp {
    pub col: LampCol,
    pub blink: u8,
}

impl Lamp {
    const fn new(col: LampCol, blink: u8) -> Self {
        Self { col, blink }
    }
}

pub const LAMP_LABELS: [&str; 10] = ["SCHILD", "HÜLLE", "SUCHER", "BOOST", "FUNK", "ZIEL", "LOCK", "WAFFEN", "MINE", "AUTO"];

#[derive(Clone, Copy, Debug)]
struct SparkP {
    p: Vec3,
    v: Vec3,
    life: f32,
}

/// Everything the cockpit remembers between frames (reset on every mission / new player ship).
#[derive(Resource)]
pub struct CockpitState {
    pub fail: [Fail; Elem::COUNT],
    /// element positions in cockpit space (spark sources)
    elem_pos: [Vec3; Elem::COUNT],
    pub lamps: [Lamp; 10],
    pub rng: Rng,
    /// seconds of mission time
    pub mission_t: f32,
    /// time of the last radio call (FUNK lamp)
    pub comm_t: f32,
    /// last hit time per shield sector: front, right, back, left
    pub hit_side: [f32; 4],
    /// hull hit marks in ship space (x, z) and their time
    pub marks: Vec<(Vec2, f32)>,
    pub cracks: u32,
    sparks: Vec<SparkP>,
    shake: f32,
    player: Option<Entity>,
    last_lock: bool,
    shield_down: bool,
}

impl Default for CockpitState {
    fn default() -> Self {
        Self {
            fail: [Fail::Ok; Elem::COUNT],
            elem_pos: [Vec3::ZERO; Elem::COUNT],
            lamps: [Lamp::default(); 10],
            rng: Rng::new(0x5eed),
            mission_t: 0.0,
            comm_t: -100.0,
            hit_side: [-100.0; 4],
            marks: Vec::with_capacity(8),
            cracks: 0,
            sparks: vec![SparkP { p: Vec3::ZERO, v: Vec3::ZERO, life: 0.0 }; 48],
            shake: 0.0,
            player: None,
            last_lock: false,
            shield_down: false,
        }
    }
}

impl CockpitState {
    fn spark_at(&mut self, e: Elem, n: usize) {
        let p0 = self.elem_pos[e as usize];
        let mut n = n;
        for i in 0..self.sparks.len() {
            if self.sparks[i].life > 0.0 {
                continue;
            }
            let r = &mut self.rng;
            self.sparks[i] = SparkP {
                p: p0 + Vec3::new(r.range(-0.03, 0.03), r.range(-0.02, 0.02), 0.01),
                v: Vec3::new(r.range(-0.25, 0.25), r.range(-0.05, 0.3), r.range(0.05, 0.35)),
                life: r.range(0.25, 0.7),
            };
            n -= 1;
            if n == 0 {
                break;
            }
        }
    }
}

/// Test hook `SF_COCKPIT_DAMAGE=1`: one second into the mission the ship is badly hurt (low shield and hull,
/// failed instruments, canopy cracks, sparks), for screenshots of the damaged cockpit.
fn test_damage(
    mut on: Local<Option<bool>>,
    mut state: ResMut<CockpitState>,
    mut screens: ResMut<Screens>,
    mut images: ResMut<Assets<Image>>,
    mut players: Query<&mut Ship, With<Player>>,
) {
    let enabled = *on.get_or_insert_with(|| std::env::var("SF_COCKPIT_DAMAGE").is_ok_and(|v| v != "0"));
    if !enabled || state.mission_t < 1.0 {
        return;
    }
    *on = Some(false);
    if let Ok(mut ship) = players.single_mut() {
        ship.hp = ship.max_hp * 0.24;
        ship.shield = ship.max_shield * 0.1;
    }
    for (e, f) in [(Elem::Mfd2, Fail::Dead), (Elem::Log1, Fail::Flicker), (Elem::Bank2, Fail::Dead), (Elem::Seg, Fail::Flicker)] {
        state.fail[e as usize] = f;
        state.spark_at(e, 14);
    }
    let t = state.mission_t;
    state.hit_side[0] = t + 60.0;
    for _ in 0..3 {
        state.cracks += 1;
        screens.add_crack(&mut images, &mut state.rng);
    }
    state.marks.push((Vec2::new(1.5, 2.0), -100.0));
    state.marks.push((Vec2::new(-2.0, -3.0), -100.0));
    screens.log_fmt(0, t, 0xff4d6d, format_args!("STÖRUNG · ZIELDISPLAY AUSGEFALLEN"));
}

fn reset_cockpit(mut state: ResMut<CockpitState>, mut screens: ResMut<Screens>, mut images: ResMut<Assets<Image>>) {
    let elem_pos = state.elem_pos;
    *state = CockpitState { elem_pos, ..default() };
    screens.repair(&mut images);
}

// ---------- building ----------

/// Static geometry merged per material plus the animated parts as their own entities.
struct Builder<'w, 's, 'a> {
    commands: Commands<'w, 's>,
    meshes: &'a mut Assets<Mesh>,
    assets: &'a mut CockpitAssets,
    mats: &'a mut Assets<StandardMaterial>,
    root: Entity,
    merged: HashMap<M, Geo>,
    bolts: Vec<Mat4>,
}

impl Builder<'_, '_, '_> {
    /// static part of material `m` at `xf`
    fn add(&mut self, m: M, g: &Geo, xf: Mat4) {
        let uv_k = 1.0 / tile(m);
        self.merged.entry(m).or_default().append(g, &xf, uv_k);
    }
    fn bolt(&mut self, xf: Mat4, x: f32, y: f32, z: f32) {
        self.bolts.push(xf * Mat4::from_translation(Vec3::new(x, y, z)));
    }
    /// an entity of its own (animated or with a changing material)
    fn part(&mut self, parent: Entity, g: &Geo, mat: Handle<StandardMaterial>, xf: Mat4) -> Entity {
        let mesh = self.meshes.add(scale_uv(g, 1.0).to_mesh());
        self.commands.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::from_matrix(xf), ChildOf(parent), NotShadowCaster)).id()
    }
    fn part_m(&mut self, parent: Entity, g: &Geo, m: M, xf: Mat4) -> Entity {
        let mesh = self.meshes.add(scale_uv(g, 1.0 / tile(m)).to_mesh());
        let mat = self.assets.mat(m);
        self.commands.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::from_matrix(xf), ChildOf(parent), NotShadowCaster)).id()
    }
    /// an empty pivot
    fn pivot(&mut self, parent: Entity, xf: Mat4) -> Entity {
        self.commands.spawn((Transform::from_matrix(xf), Visibility::default(), ChildOf(parent))).id()
    }
    fn finish(mut self) {
        for (m, g) in std::mem::take(&mut self.merged) {
            if g.is_empty() {
                continue;
            }
            let mesh = self.meshes.add(g.to_mesh());
            let mat = self.assets.mat(m);
            self.commands.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::IDENTITY, ChildOf(self.root), NotShadowCaster));
        }
        let (bolt, steel) = (self.assets.bolt.clone(), self.assets.mat(M::Steel));
        for xf in std::mem::take(&mut self.bolts) {
            self.commands.spawn((Mesh3d(bolt.clone()), MeshMaterial3d(steel.clone()), Transform::from_matrix(xf), ChildOf(self.root), NotShadowCaster));
        }
    }
}

fn scale_uv(g: &Geo, k: f32) -> Geo {
    let mut g = g.clone();
    for uv in &mut g.uv {
        *uv *= k;
    }
    g
}

fn rx(a: f32) -> Mat4 {
    Mat4::from_rotation_x(a)
}
fn ry(a: f32) -> Mat4 {
    Mat4::from_rotation_y(a)
}
fn rz(a: f32) -> Mat4 {
    Mat4::from_rotation_z(a)
}
fn tr(x: f32, y: f32, z: f32) -> Mat4 {
    Mat4::from_translation(Vec3::new(x, y, z))
}
fn trv(v: Vec3) -> Mat4 {
    Mat4::from_translation(v)
}

/// points on an arc around the camera at radius `rad`, height `y`, from `a0` to `a1` degrees
fn arc(rad: f32, y: f32, a0: f32, a1: f32, n: usize) -> Vec<Vec3> {
    (0..=n)
        .map(|i| {
            let a = (a0 + (a1 - a0) * i as f32 / n as f32).to_radians();
            Vec3::new(rad * a.sin(), y, -rad * a.cos())
        })
        .collect()
}

/// (Re)builds the cockpit when there is none yet or the window shape changed.
#[allow(clippy::too_many_arguments)]
fn ensure_built(
    mut commands: Commands,
    cam: Query<(Entity, &Projection), With<MainCamera>>,
    roots: Query<(Entity, &CockpitRoot)>,
    assets: Option<ResMut<CockpitAssets>>,
    screens: Option<Res<Screens>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    mut state: ResMut<CockpitState>,
) {
    let (Some(mut assets), Some(screens)) = (assets, screens) else { return };
    let Ok((cam, proj)) = cam.single() else { return };
    let aspect = match proj {
        Projection::Perspective(p) => p.aspect_ratio.max(0.2),
        _ => 16.0 / 9.0,
    };
    let fov = layout_fov(aspect);
    if let Some((e, root)) = roots.iter().next() {
        if (root.layout.aspect - aspect).abs() < 0.04 && root.layout.fov == fov {
            return;
        }
        commands.entity(e).despawn();
    }
    let layout = Layout::new(aspect, fov);
    let root = commands
        .spawn((Name::new("Cockpit"), CockpitRoot { layout }, Transform::from_scale(Vec3::splat(SCALE)), Visibility::Hidden, ChildOf(cam)))
        .id();
    let mut b = Builder { commands, meshes: &mut meshes, assets: &mut assets, mats: &mut mats, root, merged: HashMap::new(), bolts: Vec::new() };
    build_cockpit(&mut b, &layout, &screens, &mut state);
    b.finish();
}

fn build_cockpit(b: &mut Builder, l: &Layout, screens: &Screens, state: &mut CockpitState) {
    let root = b.root;
    let (r, h) = (l.r, l.h);
    let panel = l.panel();
    let half_span = l.span * 0.5;

    // --- curved wrap-around console ---
    b.add(M::Dark, &geom::shell(r, r * 1.04, h, -half_span, half_span, 64), panel);
    // lower knee panel: closes the view below the console down to the pilot's legs
    let mut knee = geom::shell(r * 1.04, r * 0.62, 0.34, -half_span + 2.0, half_span - 2.0, 48);
    for p in &mut knee.pos {
        p.y -= h * 0.5 + 0.17;
    }
    b.add(M::Dark, &knee, panel);
    // padded glare shield lip, orange trim, rubber edge
    b.add(M::Metal, &geom::tube(&arc(r + 0.03, h * 0.5 + 0.02, -half_span + 6.0, half_span - 6.0, 48), 0.03, 0.015, 96, 12, Vec3::Y), panel);
    b.add(M::Trim, &geom::tube(&arc(r - 0.008, h * 0.5 - 0.004, -48.0, 48.0, 24), 0.004, 0.004, 64, 6, Vec3::Y), panel);
    b.add(M::Rubber, &geom::tube(&arc(r * 1.02, -h * 0.5, -half_span + 4.0, half_span - 4.0, 48), 0.02, 0.02, 96, 8, Vec3::Y), panel);
    // glare shield top (closes the gap between lip and canopy sill)
    b.add(M::Dark, &glare_top(r + 0.03, h * 0.5 + 0.02, half_span - 6.0), panel);

    // --- three MFDs with worn bezels, recessed screens, visors and soft keys ---
    let mfd_place = [(-40.0, Elem::Mfd0, 0.155, 0.0), (0.0, Elem::Mfd1, 0.2, -0.012), (40.0, Elem::Mfd2, 0.155, 0.0)];
    for (deg, elem, mw, my) in mfd_place {
        let mh = mw * 0.75;
        // flat parts stand proud of the curved console so their edges do not sink into it
        let fl = l.flat(mw * 1.22);
        b.add(M::Bezel, &geom::rounded_slab(mw * 1.22, mh * 1.3, 0.014, 0.01 + fl, 0.004), l.place(deg, my, 0.004 + fl));
        screen_frame(b, mw, mh, l.place(deg, my, 0.0085 + fl));
        let xf = l.place(deg, my, 0.0085 + fl);
        b.part(root, &geom::plane(mw, mh), screens.mat(elem), xf);
        b.add(M::ScreenGlass, &geom::plane(mw, mh), xf * tr(0.0, 0.0, 0.0012));
        state.elem_pos[elem as usize] = xf.transform_point3(Vec3::ZERO);
        // sun visor over the display, with side cheeks
        let vz = l.place(deg, my + mh * 0.65 + 0.004, 0.006 + fl);
        b.add(M::SteelDark, &geom::rounded_slab(mw * 1.3, 0.042, 0.006, 0.004, 0.002), vz * tr(0.0, 0.0, 0.019) * rx(-1.25));
        for sx in [-1.0, 1.0] {
            b.add(M::SteelDark, &geom::cuboid(0.004, 0.03, 0.036), vz * tr(sx * mw * 0.64, -0.012, 0.016) * rx(0.45));
        }
        for side in [-1.0, 1.0] {
            for k in 0..4 {
                let d = deg + (side * mw * 0.56 / r).to_degrees();
                b.add(M::Rubber, &geom::cuboid(0.009, 0.012, 0.006), l.place(d, my - mh * 0.38 + k as f32 * mh * 0.25, 0.011 + fl * 0.3));
            }
        }
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            let (w, hh) = (mw * 1.22, mh * 1.3);
            b.bolt(l.place(deg, my, 0.004 + fl), sx * (w / 2.0 - 0.008), sy * (hh / 2.0 - 0.008), 0.006);
        }
    }
    // narrow text screens with scrolling system messages
    for (deg, elem) in [(-23.0, Elem::Log0), (23.0, Elem::Log1)] {
        let fl = l.flat(0.074);
        b.add(M::Bezel, &geom::rounded_slab(0.074, 0.112, 0.01, 0.008 + fl, 0.004), l.place(deg, 0.012, 0.005 + fl));
        screen_frame(b, 0.064, 0.08, l.place(deg, 0.012, 0.0095 + fl));
        let xf = l.place(deg, 0.012, 0.0095 + fl);
        b.part(root, &geom::plane(0.064, 0.08), screens.mat(elem), xf);
        b.add(M::ScreenGlass, &geom::plane(0.064, 0.08), xf * tr(0.0, 0.0, 0.0012));
        state.elem_pos[elem as usize] = xf.transform_point3(Vec3::ZERO);
    }
    // banks of illuminated push-buttons under the displays
    use ButtonKind as K;
    let banks: [(f32, f32, usize, &[ButtonKind], Elem); 5] = [
        (-40.0, -0.1, 7, &[K::ShieldGen, K::Idle, K::Guns, K::Idle, K::Nav, K::Idle, K::Ecm], Elem::Bank0),
        (0.0, -0.128, 10, &[K::Missile], Elem::Bank1),
        (40.0, -0.1, 7, &[K::Boost, K::Idle, K::Comm, K::Idle, K::Auto, K::Idle, K::Hull], Elem::Bank2),
        (-23.0, -0.075, 4, &[K::Idle, K::Nav, K::Idle, K::Guns], Elem::Bank3),
        (23.0, -0.075, 4, &[K::Comm, K::Idle, K::Ecm, K::Idle], Elem::Bank4),
    ];
    let cap = geom::rounded_slab(0.013, 0.009, 0.0015, 0.006, 0.0012);
    let tray = geom::cuboid(0.0172, 0.017, 0.004);
    let off = b.assets.lamp(b.mats, CapBase::Button, [0.0; 3]);
    for (deg, y, n, kinds, bank) in banks {
        for k in 0..n {
            let d = deg + ((k as f32 - (n as f32 - 1.0) / 2.0) * 0.017 / r).to_degrees();
            let xf = l.place(d, y, 0.012);
            if k == n / 2 {
                state.elem_pos[bank as usize] = xf.transform_point3(Vec3::ZERO);
            }
            let e = b.part(root, &cap, off.clone(), xf);
            let phase = state.rng.f() * 6.0;
            b.commands.entity(e).insert(Button { kind: kinds[k % kinds.len()], idx: k, phase, bank });
            // dark tray behind the bank, following the curve
            b.add(M::Inset, &tray, l.place(d, y, 0.008));
        }
    }
    // annunciator strip above the radar
    let fl = l.flat(0.29);
    b.add(M::Bezel, &geom::rounded_slab(0.29, 0.068, 0.008, 0.006 + fl, 0.003), l.place(0.0, 0.128, 0.006 + fl));
    let xf = l.place(0.0, 0.128, 0.0095 + fl);
    b.part(root, &geom::plane(0.27, 0.054), screens.mat(Elem::Annun), xf);
    state.elem_pos[Elem::Annun as usize] = xf.transform_point3(Vec3::ZERO);
    // stickers and maintenance plaques
    for (deg, y, i, rot) in [(-15.5, -0.135, 0u8, 0.03), (16.0, -0.14, 1, -0.04), (-58.0, 0.08, 2, 0.05)] {
        b.add(M::Decal(i), &geom::plane(0.075, 0.028), l.place(deg, y, 0.002 + l.flat(0.075)) * rz(rot));
    }
    // master caution push-button
    let mc = l.place(-19.0, 0.11, 0.014);
    let cap_e = b.part(root, &geom::cylinder(0.016, 0.017, 0.012, 24, true), off.clone(), mc * rx(FRAC_PI_2));
    b.commands.entity(cap_e).insert(CautionCap);
    b.add(M::Chrome, &geom::torus(0.019, 0.003, 24, 8), mc * rx(FRAC_PI_2));
    // red alarm light near the caution button, cool glow of the displays, soft cabin fill
    let ap = mc.transform_point3(Vec3::ZERO) + Vec3::new(0.0, 0.06, 0.12);
    b.commands.spawn((
        AlarmLight,
        PointLight { color: Color::srgb(1.0, 0.13, 0.19), intensity: 0.0, range: 1.4 * SCALE, radius: 0.02 * SCALE, ..default() },
        Transform::from_translation(ap),
        ChildOf(root),
    ));
    b.commands.spawn((
        ScreenLight,
        PointLight { color: Color::srgb(0.5, 0.88, 1.0), intensity: 0.5 * CANDELA * SCALE * SCALE, range: 1.0 * SCALE, radius: 0.1 * SCALE, ..default() },
        Transform::from_translation(Vec3::new(0.0, l.panel_y + 0.05, -0.35)),
        ChildOf(root),
    ));
    // the web cockpit's hemisphere light: cool from above, a warm bounce from below
    b.commands.spawn((
        PointLight { color: Color::srgb(0.48, 0.59, 0.72), intensity: 0.32 * CANDELA * SCALE * SCALE, range: 2.2 * SCALE, radius: 0.3 * SCALE, ..default() },
        Transform::from_translation(Vec3::new(0.0, 0.55, 0.15)),
        ChildOf(root),
    ));
    b.commands.spawn((
        PointLight { color: Color::srgb(0.6, 0.45, 0.32), intensity: 0.06 * CANDELA * SCALE * SCALE, range: 1.6 * SCALE, radius: 0.3 * SCALE, ..default() },
        Transform::from_translation(Vec3::new(0.0, l.panel_y - 0.35, -0.2)),
        ChildOf(root),
    ));

    build_retrofit(b, l, screens, state);
    build_cables(b, l);
    build_canopy(b, l, screens);
    build_controls(b, l);
    build_side_consoles(b, l);

    // spark pool
    let (sm, smat) = b.assets.spark.clone();
    for i in 0..state.sparks.len() {
        b.commands.spawn((Spark(i), Mesh3d(sm.clone()), MeshMaterial3d(smat.clone()), Transform::default(), Visibility::Hidden, ChildOf(root), NotShadowCaster));
    }
}

/// flat top of the glare shield: from the lip back towards the canopy sill
fn glare_top(rad: f32, y: f32, half: f32) -> Geo {
    let mut g = Geo::default();
    let n = 48;
    for i in 0..=n {
        let a = (-half + 2.0 * half * i as f32 / n as f32).to_radians();
        let (s, c) = a.sin_cos();
        let u = a * rad;
        g.vert(Vec3::new(rad * s, y + 0.012, -rad * c), Vec3::Y, Vec2::new(u, 0.0));
        g.vert(Vec3::new((rad + 0.16) * s, y + 0.004, -(rad + 0.16) * c), Vec3::Y, Vec2::new(u, 0.16));
    }
    for i in 0..n as u32 {
        let (a, bb) = (i * 2, i * 2 + 2);
        g.quad(a, a + 1, bb + 1, bb);
    }
    g
}

/// thin raised lip around a display, so the glass sits recessed in its bezel
fn screen_frame(b: &mut Builder, w: f32, h: f32, xf: Mat4) {
    let t = 0.004;
    for (x, y, bw, bh) in [(0.0, h * 0.5 + t * 0.5, w + t * 2.0, t), (0.0, -h * 0.5 - t * 0.5, w + t * 2.0, t), (w * 0.5 + t * 0.5, 0.0, t, h), (-w * 0.5 - t * 0.5, 0.0, t, h)] {
        b.add(M::Inset, &geom::cuboid(bw, bh, 0.006), xf * tr(x, y, 0.0015));
    }
}

/// louvred ribs, instrument pods with seven-segment readouts, LED bars, keypad and guarded toggles
fn build_retrofit(b: &mut Builder, l: &Layout, screens: &Screens, state: &mut CockpitState) {
    let root = b.root;
    let (r, h) = (l.r, l.h);
    for deg in [-29.0, 29.0] {
        let rib = l.place(deg, 0.0, 0.016);
        b.add(M::SteelDark, &geom::rounded_slab(0.034, h * 0.92, 0.006, 0.03, 0.003), rib);
        for k in 0..9 {
            b.add(M::Steel, &geom::cuboid(0.03, 0.0035, 0.016), rib * tr(0.0, -h * 0.36 + k as f32 * h * 0.09, 0.006) * rx(0.7));
        }
        for y in [-h * 0.43, h * 0.43] {
            b.bolt(rib, 0.0, y, 0.005);
        }
    }
    // pods standing on the glare shield, faces tilted up towards the pilot
    let pod = |b: &mut Builder, deg: f32, w: f32, ph: f32, d: f32| -> Mat4 {
        let (a, rr) = (deg.to_radians(), r - 0.004);
        let xf = l.panel() * tr(rr * a.sin(), h * 0.5 + ph * 0.5 + 0.012, -rr * a.cos()) * ry(-a) * rx(-0.32);
        b.add(M::Steel, &geom::rounded_slab(w, ph, 0.01, d, 0.005), xf);
        for sx in [-1.0, 1.0] {
            b.add(M::SteelDark, &geom::rounded_slab(0.012, ph * 1.15, 0.004, d * 1.1, 0.003), xf * tr(sx * (w / 2.0 + 0.004), -ph * 0.05, 0.004));
        }
        b.add(M::SteelDark, &geom::cuboid(w * 1.04, 0.006, 0.03), xf * tr(0.0, ph / 2.0 + 0.002, 0.008) * rx(0.25));
        b.add(M::Dark, &geom::cuboid(w * 0.7, 0.02, d * 0.8), xf * tr(0.0, -ph / 2.0 - 0.008, -d / 2.0));
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            b.bolt(xf, sx * (w / 2.0 - 0.007), sy * (ph / 2.0 - 0.007), 0.006);
        }
        xf
    };
    // left pod: three rows of seven-segment readouts
    let pl = pod(b, -34.0, 0.17, 0.074, 0.05);
    let xf = pl * tr(0.0, 0.0, 0.0065);
    b.part(root, &geom::plane(0.15, 0.0656), screens.mat(Elem::Seg), xf);
    state.elem_pos[Elem::Seg as usize] = xf.transform_point3(Vec3::ZERO);
    // right pod: LED bar graphs, keypad, rotary knob and guarded toggle switches on top
    let pr = pod(b, 34.0, 0.17, 0.074, 0.05);
    let xf = pr * tr(-0.042, 0.0, 0.0065);
    b.part(root, &geom::plane(0.07, 0.06), screens.mat(Elem::Bar), xf);
    state.elem_pos[Elem::Bar as usize] = xf.transform_point3(Vec3::ZERO);
    let key = geom::rounded_slab(0.016, 0.011, 0.002, 0.004, 0.0015);
    let key_off = b.assets.lamp(b.mats, CapBase::Key, [0.02; 3]);
    for row in 0..4 {
        for c in 0..3 {
            let e = b.part(root, &key, key_off.clone(), pr * tr(0.02 + c as f32 * 0.021, 0.022 - row as f32 * 0.0145, 0.009));
            let phase = state.rng.f() * 10.0;
            b.commands.entity(e).insert(KeyCap { phase });
        }
    }
    b.add(M::Rubber, &geom::cylinder(0.011, 0.013, 0.014, 18, true), pr * tr(0.076, -0.02, 0.012) * rx(FRAC_PI_2));
    b.add(M::Steel, &geom::cuboid(0.003, 0.012, 0.003), pr * tr(0.076, -0.016, 0.02));
    let led_off = b.assets.lamp(b.mats, CapBase::Led, [0.05, 0.0, 0.0]);
    for i in 0..4 {
        let base = pr * tr(-0.06 + i as f32 * 0.04, 0.037 + 0.006, 0.012);
        b.add(M::Steel, &geom::cylinder(0.005, 0.005, 0.004, 6, true), base);
        let lever = b.pivot(root, base);
        b.commands.entity(lever).insert(Toggle::Lever(i));
        b.part_m(lever, &geom::cylinder(0.0016, 0.0024, 0.018, 8, true), M::Chrome, tr(0.0, 0.009, 0.0));
        b.part_m(lever, &geom::sphere(0.0028, 8, 6), M::Chrome, tr(0.0, 0.018, 0.0));
        let hinge = b.pivot(root, base * tr(0.0, 0.002, -0.011));
        b.commands.entity(hinge).insert(Toggle::Cover(i));
        b.part_m(hinge, &geom::cuboid(0.013, 0.022, 0.02), M::RedCover, tr(0.0, 0.011, 0.01));
        let led = b.part(root, &geom::sphere(0.0022, 8, 6), led_off.clone(), base * tr(0.009, 0.001, 0.008));
        b.commands.entity(led).insert(Toggle::Led(i));
    }
}

/// cable bundles and a corrugated conduit from the pods along the sill and up the canopy pillars
fn build_cables(b: &mut Builder, l: &Layout) {
    let (r, h) = (l.r, l.h);
    for sx in [-1.0f32, 1.0] {
        let (a, rr) = ((34.0 * sx).to_radians(), r - 0.004);
        let pod = l.panel() * tr(rr * a.sin(), h * 0.5 + 0.074 * 0.5 + 0.012, -rr * a.cos()) * ry(-a) * rx(-0.32);
        let start = pod.transform_point3(Vec3::new(sx * 0.09, -0.01, -0.03));
        let (base, up1, up2) = (l.s(0.97 * sx, -0.47, 0.64), l.s(0.93 * sx, 0.05, 0.57), l.s(0.76 * sx, 0.62, 0.47));
        for k in 0..4 {
            let off = Vec3::new(-sx * (0.004 + k as f32 * 0.006), (k as f32 - 1.5) * 0.004, 0.003 * k as f32);
            let sag = start.lerp(base, 0.5) + Vec3::new(0.0, -0.05 - k as f32 * 0.012, 0.02);
            let pts = [start + off, sag, base + off, up1 + off, up2 + off];
            let rad = if k == 3 { 0.0055 } else { 0.0035 };
            b.add(M::Cable(k as u8), &geom::tube(&pts, rad, rad, 64, 8, Vec3::Y), Mat4::IDENTITY);
        }
        let cd = [l.s(0.99 * sx, -0.62, 0.62), base + Vec3::new(sx * 0.012, 0.0, 0.0), up1 + Vec3::new(sx * 0.014, 0.0, 0.004), up2 + Vec3::new(sx * 0.012, 0.0, 0.004)];
        b.add(M::Conduit, &geom::tube(&cd, 0.009, 0.009, 64, 10, Vec3::Y), Mat4::IDENTITY);
        for t in [0.25, 0.5, 0.75] {
            let c = geom::catmull(&[base, up1, up2], t);
            let p = c + Vec3::new(-sx * 0.006, 0.0, 0.0);
            let look = Transform::from_translation(p).looking_at(Vec3::new(0.0, c.y, 0.0), Vec3::Y);
            b.add(M::SteelDark, &geom::cuboid(0.03, 0.012, 0.014), look.to_matrix());
        }
    }
}

/// canopy bow, A-pillars, sill rails, smudged glass, crack layer and the HUD combiner frame
fn build_canopy(b: &mut Builder, l: &Layout, screens: &Screens) {
    let root = b.root;
    for sx in [-1.0f32, 1.0] {
        let pillar = [l.s(0.98 * sx, -0.46, 0.66), l.s(0.93 * sx, 0.05, 0.58), l.s(0.75 * sx, 0.62, 0.48), l.s(0.5 * sx, 1.12, 0.38)];
        b.add(M::Metal, &geom::tube(&pillar, 0.016, 0.016, 48, 12, Vec3::X * sx), Mat4::IDENTITY);
        let outer = [l.s(1.04 * sx, -0.5, 0.52), l.s(1.16 * sx, 0.15, 0.44), l.s(1.22 * sx, 0.85, 0.32)];
        b.add(M::Dark, &geom::tube(&outer, 0.012, 0.012, 32, 10, Vec3::X * sx), Mat4::IDENTITY);
        let trim = [l.s(0.95 * sx, -0.44, 0.63), l.s(0.9 * sx, 0.1, 0.56), l.s(0.73 * sx, 0.6, 0.47)];
        b.add(M::Trim, &geom::tube(&trim, 0.003, 0.003, 32, 6, Vec3::X * sx), Mat4::IDENTITY);
    }
    let bow = [l.s(-0.62, 1.04, 0.42), l.s(-0.3, 1.14, 0.4), l.s(0.0, 1.17, 0.4), l.s(0.3, 1.14, 0.4), l.s(0.62, 1.04, 0.42)];
    b.add(M::Metal, &geom::tube(&bow, 0.014, 0.014, 48, 12, Vec3::Y), Mat4::IDENTITY);
    let glass = geom::sphere_patch(0.9, PI * 0.7, PI * 0.6, PI * 0.18, PI * 0.45, 32, 16, true);
    let ge = b.part_m(root, &glass, M::Glass, tr(0.0, -0.05, 0.0));
    b.commands.entity(ge).insert(CanopyGlass);
    // cracks in the canopy glass (the texture grows with heavy hits)
    let d = 0.5;
    let (a, c) = (l.s(-1.0, 1.0, d), l.s(1.0, -0.28, d));
    b.part(root, &geom::plane(c.x - a.x, a.y - c.y), screens.crack_mat.clone(), tr((a.x + c.x) / 2.0, (a.y + c.y) / 2.0, -d));
    // HUD combiner frame
    let hc = l.s(0.0, -0.3, 0.58);
    let (hw, hh) = (0.075, 0.05);
    for sx in [-1.0, 1.0] {
        b.add(M::Chrome, &geom::cylinder(0.0016, 0.0016, hh * 2.1, 6, true), trv(hc + Vec3::new(sx * hw, hh * 0.9, 0.0)) * rx(-0.35));
    }
    b.add(M::HudEdge, &geom::cuboid(hw * 2.0, 0.0014, 0.0014), trv(hc + Vec3::new(0.0, hh * 1.85, -0.017)) * rx(-0.35));
}

/// flight stick (right) and throttle quadrant (left)
fn build_controls(b: &mut Builder, l: &Layout) {
    let root = b.root;
    let stick = b.pivot(root, trv(l.s(0.37, -1.64, 0.3)));
    b.commands.entity(stick).insert(StickPivot);
    b.part_m(stick, &geom::cylinder(0.012, 0.03, 0.05, 14, true), M::Rubber, Mat4::IDENTITY);
    b.part_m(stick, &geom::cylinder(0.006, 0.007, 0.09, 10, true), M::Chrome, tr(0.0, 0.06, 0.0));
    let grip = b.pivot(stick, tr(0.0, 0.125, 0.004) * rx(0.25));
    b.part_m(grip, &geom::capsule(0.017, 0.06, 14), M::Rubber, Mat4::IDENTITY);
    b.part_m(grip, &geom::cuboid(0.008, 0.016, 0.01), M::Trim, tr(0.0, 0.012, -0.019));
    b.part_m(grip, &geom::cylinder(0.005, 0.005, 0.006, 10, true), M::Chrome, tr(0.0, 0.048, 0.0));
    let hand = b.pivot(grip, Mat4::IDENTITY);
    b.commands.entity(hand).insert(HandMount::Stick);
    // boot at the base of the stick
    b.part_m(stick, &geom::cylinder(0.034, 0.05, 0.03, 16, true), M::Rubber, tr(0.0, -0.03, 0.0));

    let thr = b.pivot(root, trv(l.s(-0.44, -1.56, 0.32)) * ry(0.25));
    b.part_m(thr, &geom::rounded_slab(0.05, 0.16, 0.012, 0.018, 0.004), M::Metal, rx(-FRAC_PI_2));
    // slot in the rail
    b.part_m(thr, &geom::cuboid(0.014, 0.004, 0.13), M::Inset, tr(0.0, 0.0035, 0.0));
    let lever = b.pivot(thr, tr(0.0, 0.0, 0.0));
    b.commands.entity(lever).insert(ThrottleLever);
    b.part_m(lever, &geom::cuboid(0.012, 0.06, 0.012), M::Chrome, tr(0.0, 0.03, 0.0));
    b.part_m(lever, &geom::rounded_slab(0.066, 0.034, 0.008, 0.028, 0.003), M::Rubber, tr(0.0, 0.083, 0.0) * rx(-FRAC_PI_2));
    b.part_m(lever, &geom::cylinder(0.005, 0.005, 0.006, 10, true), M::Trim, tr(0.034, 0.07, -0.01) * rz(FRAC_PI_2));
    let hand = b.pivot(lever, tr(0.0, 0.068, 0.0) * rx(0.22));
    b.commands.entity(hand).insert(HandMount::Throttle);
}

/// low side consoles along the sills with switch rows and a circuit-breaker panel
fn build_side_consoles(b: &mut Builder, l: &Layout) {
    for sx in [-1.0f32, 1.0] {
        let c = l.s(0.86 * sx, -1.15, 0.5);
        let xf = trv(c) * ry(-sx * 0.95) * rx(-1.05);
        b.add(M::Dark, &geom::rounded_slab(0.26, 0.42, 0.02, 0.05, 0.006), xf);
        b.add(M::Metal, &geom::cuboid(0.012, 0.42, 0.03), xf * tr(sx * 0.13, 0.0, 0.0));
        for row in 0..3 {
            let y = 0.12 - row as f32 * 0.09;
            b.add(M::Bezel, &geom::rounded_slab(0.2, 0.05, 0.006, 0.006, 0.002), xf * tr(0.0, y, 0.004));
            for k in 0..5 {
                let x = -0.08 + k as f32 * 0.04;
                b.add(M::Steel, &geom::cylinder(0.005, 0.005, 0.004, 6, true), xf * tr(x, y, 0.012) * rx(FRAC_PI_2));
                b.add(M::Chrome, &geom::cylinder(0.0014, 0.002, 0.016, 6, true), xf * tr(x, y + 0.004, 0.018) * rx(FRAC_PI_2 - 0.5));
            }
        }
        // breaker panel: rows of small black pull-buttons
        for row in 0..2 {
            for k in 0..7 {
                b.add(M::Rubber, &geom::cylinder(0.004, 0.0045, 0.008, 8, true), xf * tr(-0.075 + k as f32 * 0.025, -0.13 - row as f32 * 0.03, 0.008) * rx(FRAC_PI_2));
            }
        }
    }
}

// ---------- per-frame updates ----------

/// Show the cockpit only in the cockpit view of a living player.
fn cockpit_visibility(
    state: Res<State<AppState>>,
    settings: Res<Settings>,
    players: Query<Has<Dying>, With<Player>>,
    mut roots: Query<&mut Visibility, With<CockpitRoot>>,
) {
    let alive = players.iter().next().is_some_and(|dying| !dying);
    let on = *state.get() == AppState::Flight && settings.view == View::Cockpit && alive;
    for mut v in &mut roots {
        v.set_if_neq(if on { Visibility::Inherited } else { Visibility::Hidden });
    }
}

/// Hits, radio calls and kills: shield sectors, hull marks, damage to the instruments, log lines.
#[allow(clippy::too_many_arguments)]
fn cockpit_events(
    time: Res<Time>,
    paused: Res<Paused>,
    data: Res<GameData>,
    mut state: ResMut<CockpitState>,
    mut screens: ResMut<Screens>,
    mut images: ResMut<Assets<Image>>,
    mut hits: MessageReader<HitFxMsg>,
    mut dmg: MessageReader<DamageMsg>,
    mut comms: MessageReader<CommMsg>,
    mut kills: MessageReader<KilledMsg>,
    players: Query<(Entity, &Transform, &Ship, &Player)>,
) {
    let t = time.elapsed_secs();
    let Ok((pe, ptf, ship, player)) = players.single() else {
        hits.clear();
        dmg.clear();
        comms.clear();
        kills.clear();
        return;
    };
    if state.player != Some(pe) {
        // new ship: everything works again
        let elem_pos = state.elem_pos;
        *state = CockpitState { elem_pos, player: Some(pe), ..default() };
        screens.repair(&mut images);
    }
    if !paused.0 {
        state.mission_t += time.delta_secs();
    }
    let inv = ptf.rotation.inverse();
    for h in hits.read() {
        if h.ship != pe {
            continue;
        }
        let local = inv * (h.pos - ptf.translation);
        // web sectors: front (+z), right (-x), back, left (+x)
        let side = if local.z.abs() >= local.x.abs() {
            if local.z >= 0.0 { 0 } else { 2 }
        } else if local.x < 0.0 {
            1
        } else {
            3
        };
        state.hit_side[side] = t;
        if !h.shield {
            if state.marks.len() >= 8 {
                state.marks.remove(0);
            }
            state.marks.push((Vec2::new(local.x, local.z), t));
        }
    }
    let hk = ship.hp / ship.max_hp.max(1.0);
    for d in dmg.read() {
        if d.target != pe || ship.shield > 0.5 {
            continue;
        }
        // hull hit: the worse the damage, the likelier an instrument drops out; heavy hits crack the canopy
        let amount = d.amount;
        if hk < 0.45 && state.cracks < 4 && state.rng.chance(0.18 + amount * 0.01) {
            state.cracks += 1;
            screens.add_crack(&mut images, &mut state.rng);
        }
        if hk > 0.72 || state.rng.f() > (0.65f32).min((0.75 - hk) * 0.9 + amount * 0.01) {
            continue;
        }
        let alive: usize = state.fail.iter().filter(|f| **f != Fail::Dead).count();
        if alive == 0 {
            continue;
        }
        let mut pick = (state.rng.f() * alive as f32) as usize;
        let mut chosen = None;
        for (i, f) in state.fail.iter().enumerate() {
            if *f == Fail::Dead {
                continue;
            }
            if pick == 0 {
                chosen = Some(i);
                break;
            }
            pick -= 1;
        }
        let Some(i) = chosen else { continue };
        let e = Elem::ALL[i];
        let new = if state.fail[i] != Fail::Ok {
            Fail::Dead
        } else if hk > 0.35 || state.rng.chance(0.5) {
            Fail::Flicker
        } else {
            Fail::Dead
        };
        state.fail[i] = new;
        state.spark_at(e, 18);
        screens.log_fmt(0, t, 0xff4d6d, format_args!("STÖRUNG · {}{}", e.label(), if new == Fail::Dead { " AUSGEFALLEN" } else { "" }));
    }
    if ship.shield <= 0.5 && ship.max_shield > 0.0 && !state.shield_down {
        state.shield_down = true;
        screens.log_fmt(0, t, 0xffc857, format_args!("SCHILD ZUSAMMENGEBROCHEN"));
    } else if ship.shield > ship.max_shield * 0.25 {
        state.shield_down = false;
    }
    let locked = player.lock >= 1.0;
    if locked && !state.last_lock {
        screens.log_fmt(0, t, 0x6dffb0, format_args!("NEUTRON-ERFASSUNG · LOCK"));
    }
    state.last_lock = locked;
    for c in comms.read() {
        state.comm_t = t;
        let who = data.campaign.chars.get(&c.who).map(|ch| if ch.short.is_empty() { ch.name.as_str() } else { ch.short.as_str() }).unwrap_or(c.who.as_str());
        screens.comm(t, who, &c.text);
    }
    for k in kills.read() {
        if k.by_player {
            let name = data.ship(&k.kind).name.as_str();
            screens.log_fmt(0, t, 0x7fd6ff, format_args!("ABSCHUSS BESTÄTIGT · {name}"));
        } else if k.team == ship.team {
            let name = data.ship(&k.kind).name.as_str();
            screens.log_fmt(0, t, 0xff4d6d, format_args!("VERLUST · {name}"));
        }
    }
}

/// Stick, throttle, toggles and the cabin's vibration follow the pilot's inputs.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
fn animate_controls(
    time: Res<Time>,
    settings: Res<Settings>,
    status: Res<MissionStatus>,
    seeker: Option<Res<SeekerWarning>>,
    shake_res: Option<Res<crate::render::CameraShake>>,
    mut state: ResMut<CockpitState>,
    players: Query<(&Player, Option<&Pilot>, Option<&Trigger>, Option<&PlayerAim>)>,
    mut roots: Query<&mut Transform, (With<CockpitRoot>, Without<StickPivot>, Without<ThrottleLever>, Without<Toggle>)>,
    mut stick: Query<&mut Transform, (With<StickPivot>, Without<ThrottleLever>, Without<Toggle>)>,
    mut lever: Query<&mut Transform, (With<ThrottleLever>, Without<Toggle>)>,
    mut toggles: Query<(&Toggle, &mut Transform)>,
) {
    let dt = time.delta_secs().min(0.1);
    let Ok((player, pilot, trigger, aim)) = players.single() else { return };
    let firing = trigger.is_some_and(|t| t.guns);
    // cabin buzz: engines and hits rattle the console a little
    let shake = shake_res.map_or(0.0, |s| s.0);
    state.shake = (state.shake * (-dt * 6.0).exp()).max(shake * 0.4);
    let buzz = (if player.boosting { 0.0015 } else { 0.0003 }) + state.shake * 0.004;
    let (bx, by) = (state.rng.range(-0.5, 0.5) * buzz, state.rng.range(-0.5, 0.5) * buzz);
    for mut tf in &mut roots {
        tf.translation = Vec3::new(bx, by, 0.0) * SCALE;
    }
    let st = pilot.map_or(Vec2::ZERO, |p| p.stick);
    let (cx, cy) = (st.x, st.y * if settings.invert { 1.0 } else { -1.0 });
    let k = (dt * 14.0).min(1.0);
    for mut tf in &mut stick {
        let (ex, _, ez) = tf.rotation.to_euler(EulerRot::XYZ);
        let (nx, nz) = (ex + (cy * 0.3 - ex) * k, ez + (-cx * 0.35 - ez) * k);
        tf.rotation = Quat::from_euler(EulerRot::XYZ, nx, 0.0, nz);
    }
    let k = (dt * 10.0).min(1.0);
    for mut tf in &mut lever {
        tf.translation.z += ((0.05 - player.throttle * 0.1) - tf.translation.z) * k;
        tf.rotation = Quat::from_rotation_x(if player.boosting { -0.5 } else { -0.25 - player.throttle * 0.2 });
    }
    let warn = seeker.is_some_and(|s| s.0);
    let on = [player.boosting, status.auto_available, firing || aim.is_some_and(|a| a.locked), warn];
    for (tg, mut tf) in &mut toggles {
        match *tg {
            Toggle::Lever(i) => {
                let (x, _, _) = tf.rotation.to_euler(EulerRot::XYZ);
                let goal = if on[i] { 0.55 } else { -0.55 };
                tf.rotation = Quat::from_rotation_x(x + (goal - x) * (dt * 18.0).min(1.0));
            }
            Toggle::Cover(i) => {
                let (x, _, _) = tf.rotation.to_euler(EulerRot::XYZ);
                let goal = if on[i] { -1.6 } else { 0.0 };
                tf.rotation = Quat::from_rotation_x(x + (goal - x) * (dt * 10.0).min(1.0));
            }
            Toggle::Led(_) => {}
        }
    }
}

/// Annunciator states, push-button banks, keypad, toggle LEDs, master caution and the cabin lights.
#[allow(clippy::type_complexity, clippy::too_many_arguments)]
fn update_lamps(
    time: Res<Time>,
    status: Res<MissionStatus>,
    seeker: Option<Res<SeekerWarning>>,
    mut state: ResMut<CockpitState>,
    mut assets: ResMut<CockpitAssets>,
    mut mats: ResMut<Assets<StandardMaterial>>,
    players: Query<(&Transform, &Ship, &Player, Option<&Pilot>, Option<&Trigger>, Option<&PlayerAim>)>,
    targets: Query<(), (With<Ship>, Without<Dying>)>,
    mines: Query<(&Name, &Transform), (With<InMission>, Without<Ship>)>,
    mut caps: ParamSet<(
        Query<(&Button, &mut MeshMaterial3d<StandardMaterial>)>,
        Query<(&KeyCap, &mut MeshMaterial3d<StandardMaterial>)>,
        Query<(&Toggle, &mut MeshMaterial3d<StandardMaterial>)>,
        Query<&mut MeshMaterial3d<StandardMaterial>, With<CautionCap>>,
    )>,
    mut alarm: Query<&mut PointLight, (With<AlarmLight>, Without<ScreenLight>)>,
    mut screen_light: Query<&mut PointLight, (With<ScreenLight>, Without<AlarmLight>)>,
    mut glass: Query<&MeshMaterial3d<StandardMaterial>, (With<CanopyGlass>, Without<Button>, Without<KeyCap>, Without<Toggle>, Without<CautionCap>)>,
    sky: Option<Res<crate::render::SkyInfo>>,
    cams: Query<&GlobalTransform, With<MainCamera>>,
) {
    let t = time.elapsed_secs();
    let Ok((ptf, ship, player, pilot, trigger, aim)) = players.single() else { return };
    let firing = trigger.is_some_and(|t| t.guns);
    let warn = seeker.is_some_and(|s| s.0);
    let sk = if ship.max_shield > 0.0 { ship.shield / ship.max_shield } else { 0.0 };
    let hk = ship.hp / ship.max_hp.max(1.0);
    let boost_lock = pilot.is_some_and(|p| p.boost_held) && !player.boosting && player.energy < 0.3;
    let comm = t - state.comm_t < 4.0;
    let has_target = player.target.is_some_and(|e| targets.get(e).is_ok());
    let aim_locked = aim.is_some_and(|a| a.locked);
    let mine_near = mines.iter().any(|(n, tf)| n.as_str() == "Mine" && tf.translation.distance_squared(ptf.translation) < 380.0 * 380.0);

    use LampCol::*;
    state.lamps = [
        if sk < 0.15 { Lamp::new(Red, 1) } else if sk < 0.5 { Lamp::new(Amber, 0) } else { Lamp::new(Off, 0) },
        if hk < 0.3 { Lamp::new(Red, 1) } else if hk < 0.65 { Lamp::new(Amber, 0) } else { Lamp::new(Off, 0) },
        if warn { Lamp::new(Red, 2) } else { Lamp::new(Off, 0) },
        if boost_lock { Lamp::new(Red, 0) } else if player.boosting { Lamp::new(Green, 0) } else if player.energy < 0.3 { Lamp::new(Amber, 0) } else { Lamp::new(Off, 0) },
        if comm { Lamp::new(Green, 1) } else { Lamp::new(Off, 0) },
        if has_target { Lamp::new(Green, 0) } else { Lamp::new(Off, 0) },
        if aim_locked || player.lock >= 1.0 { Lamp::new(Green, 2) } else if player.lock > 0.0 { Lamp::new(Amber, 1) } else { Lamp::new(Off, 0) },
        if firing { Lamp::new(Green, 1) } else { Lamp::new(Green, 0) },
        if mine_near { Lamp::new(Amber, 1) } else { Lamp::new(Off, 0) },
        if status.auto_available { Lamp::new(Green, 0) } else { Lamp::new(Off, 0) },
    ];
    let red = state.lamps.iter().any(|l| l.col == Red);
    let amber = !red && state.lamps.iter().any(|l| l.col == Amber);
    let flash = (t * 9.0).sin() > 0.0;

    let blink = |rate: f32, ph: f32| (t * rate + ph).sin() > 0.0;
    let recharging = ship.shield < ship.max_shield && ship.shield_t >= crate::weapons::SHIELD_DELAY;
    let max_missiles = ship.def.missiles as usize;
    let fail = state.fail;
    for (bt, mut mat) in &mut caps.p0() {
        let f = fail[bt.bank as usize];
        let off = f == Fail::Dead || (f == Fail::Flicker && (t * 37.0 + bt.phase * 11.0).sin() > 0.2);
        let e: [f32; 3] = if off {
            [0.0; 3]
        } else {
            match bt.kind {
                ButtonKind::Missile => {
                    if bt.idx < (ship.missiles as usize).min(10) || (max_missiles > 10 && bt.idx < ship.missiles as usize) {
                        [1.6, 0.9, 0.1]
                    } else {
                        [0.04, 0.02, 0.0]
                    }
                }
                ButtonKind::ShieldGen => {
                    if recharging {
                        if blink(8.0, 0.0) { [0.2, 0.9, 2.0] } else { [0.02, 0.1, 0.2] }
                    } else {
                        [0.1, 0.6, 1.4]
                    }
                }
                ButtonKind::Guns => {
                    if firing {
                        if blink(20.0, bt.idx as f32) { [2.0, 0.3, 0.2] } else { [0.3, 0.05, 0.03] }
                    } else {
                        [0.9, 0.12, 0.1]
                    }
                }
                ButtonKind::Boost => {
                    if player.boosting {
                        [0.3, 0.6, 2.4]
                    } else if boost_lock {
                        if blink(6.0, 0.0) { [2.0, 0.1, 0.1] } else { [0.1, 0.0, 0.0] }
                    } else {
                        [0.05, 0.12, 0.3]
                    }
                }
                ButtonKind::Comm => {
                    if comm {
                        if blink(10.0, bt.idx as f32) { [0.3, 1.8, 0.6] } else { [0.03, 0.2, 0.06] }
                    } else {
                        [0.03, 0.12, 0.04]
                    }
                }
                ButtonKind::Auto => {
                    if status.auto_available {
                        if blink(3.0, 0.0) { [0.3, 1.6, 0.5] } else { [0.05, 0.3, 0.1] }
                    } else {
                        [0.02, 0.06, 0.03]
                    }
                }
                ButtonKind::Hull => {
                    if hk < 0.3 {
                        if blink(7.0, 0.0) { [2.2, 0.15, 0.1] } else { [0.2, 0.0, 0.0] }
                    } else if hk < 0.65 {
                        [1.6, 0.8, 0.05]
                    } else {
                        [0.05, 0.2, 0.05]
                    }
                }
                ButtonKind::Nav => [0.1, 0.5, 0.9],
                ButtonKind::Ecm => {
                    if warn {
                        if blink(14.0, 0.0) { [2.0, 1.2, 0.1] } else { [0.2, 0.1, 0.0] }
                    } else {
                        [0.15, 0.1, 0.02]
                    }
                }
                ButtonKind::Idle => {
                    if blink(0.7 + bt.phase % 1.3, bt.phase) { [0.5, 0.45, 0.35] } else { [0.03, 0.03, 0.02] }
                }
            }
        };
        let h = assets.lamp(&mut mats, CapBase::Button, e);
        if mat.0 != h {
            mat.0 = h;
        }
    }
    for (key, mut mat) in &mut caps.p1() {
        let lit = (t * 0.7 + key.phase).sin() > 0.96;
        let h = assets.lamp(&mut mats, CapBase::Key, if lit { [0.8, 0.7, 0.4] } else { [0.02; 3] });
        if mat.0 != h {
            mat.0 = h;
        }
    }
    let on = [player.boosting, status.auto_available, firing || aim_locked, warn];
    for (tg, mut mat) in &mut caps.p2() {
        if let Toggle::Led(i) = *tg {
            let h = assets.lamp(&mut mats, CapBase::Led, if on[i] { [2.4, 0.15, 0.0] } else { [0.05, 0.0, 0.0] });
            if mat.0 != h {
                mat.0 = h;
            }
        }
    }
    let ce = if red {
        if flash { [3.2, 0.25, 0.25] } else { [0.15, 0.02, 0.02] }
    } else if amber {
        [1.6, 0.9, 0.05]
    } else {
        [0.05, 0.01, 0.02]
    };
    let h = assets.lamp(&mut mats, CapBase::Caution, ce);
    for mut mat in &mut caps.p3() {
        if mat.0 != h {
            mat.0 = h.clone();
        }
    }
    for mut l in &mut alarm {
        l.intensity = if red && flash { 0.6 * CANDELA * SCALE * SCALE } else { 0.0 };
    }
    for mut l in &mut screen_light {
        l.color = if red { Color::srgb(1.0, 0.6, 0.63) } else { Color::srgb(0.5, 0.88, 1.0) };
    }
    // smudges on the canopy light up when flying towards the sun
    if let (Some(sky), Ok(cam)) = (sky, cams.single()) {
        let v = cam.rotation().inverse() * sky.sun_dir;
        let k = 0.05 + (-v.z).max(0.0).powi(3) * 0.55 * sky.sun_visible;
        for m in &mut glass {
            let same = mats.get(&m.0).is_some_and(|mat| matches!(mat.base_color, Color::LinearRgba(old) if (old.red - k).abs() < 0.004));
            if !same && let Some(mut mat) = mats.get_mut(&m.0) {
                mat.base_color = Color::linear_rgb(k, k, k);
            }
        }
    }
}

/// Sparks from failing electronics.
fn update_sparks(time: Res<Time>, mut state: ResMut<CockpitState>, mut q: Query<(&Spark, &mut Transform, &mut Visibility)>) {
    let dt = time.delta_secs().min(0.1);
    // failing electronics keep spitting the odd spark
    for i in 0..Elem::COUNT {
        let f = state.fail[i];
        if f != Fail::Ok && state.rng.chance(dt * if f == Fail::Dead { 0.8 } else { 0.4 }) {
            state.spark_at(Elem::ALL[i], 4);
        }
    }
    for sp in &mut state.sparks {
        if sp.life > 0.0 {
            sp.life -= dt;
            sp.p += sp.v * dt;
            sp.v.y -= dt * 0.25;
            sp.v *= 1.0 - dt * 1.5;
        }
    }
    for (s, mut tf, mut vis) in &mut q {
        let sp = state.sparks[s.0];
        if sp.life > 0.0 {
            tf.translation = sp.p;
            tf.scale = Vec3::splat((sp.life * 3.0).clamp(0.3, 1.0));
            vis.set_if_neq(Visibility::Inherited);
        } else {
            vis.set_if_neq(Visibility::Hidden);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_top_sits_a_third_below_centre() {
        for aspect in [4.0 / 3.0, 16.0 / 9.0, 21.0 / 9.0] {
            let l = Layout::new(aspect, layout_fov(aspect));
            let top = l.panel().transform_point3(Vec3::new(0.0, l.h * 0.5, -l.r));
            let fy = top.y / (-top.z * l.th);
            assert!((fy + 0.33).abs() < 1e-3, "aspect {aspect}: top edge at {fy}");
        }
    }

    #[test]
    fn font_covers_all_cockpit_text() {
        let extra = ["SCHILD 100%", "HÜLLE 24%", "ÄÖÜß ✓ ⚠ → … ▲ ◆ °", "KEIN ZIEL", "SIGNAL VERLOREN"];
        for t in LAMP_LABELS.iter().chain(screens::IDLE_LINES.iter()).chain(extra.iter()) {
            for ch in t.chars() {
                assert!(ch == ' ' || canvas::has_glyph(ch), "no glyph for {ch:?} in {t:?}");
            }
        }
    }
}
