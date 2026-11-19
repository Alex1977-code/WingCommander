//! Visual effects (owner: fx agent): explosions, hit effects, engine plumes and exhaust ribbons.
//!
//! Everything is pooled and allocated once at Startup:
//! - Particle systems (fire points, flashes, lens streaks, smoke, sparks/embers, ribbon trails) live in
//!   CPU pools and are drawn from a storage buffer each: one entity and one draw call per system. The
//!   mesh is a static strip of quads whose vertices carry (particle index, corner); the vertex shader
//!   turns them to the camera.
//! - Shape effects (fireballs, shockwave / plasma rings, shield ripples, engine plumes) are pooled mesh
//!   entities sharing a few materials; the Transform carries position and size, a `MeshTag` packs the
//!   animation state, so all of them batch.
//! - Hull fragments are pooled PBR meshes, the light of explosions a fixed set of point lights.
//!
//! The shader is `assets/shaders/fx.wesl` (embedded into the binary). Colours are web values times the
//! light-scale factor of render.rs (`GAIN`); additive effects write alpha 0 into a premultiplied blend.
//!
//! Test hook: `SF_FX=1` sets off explosions, hull and shield hits in front of the player every few
//! seconds; `SF_FX=big` adds a capital ship's death sequence.

use crate::common::*;
use crate::render::CameraShake;
use bevy::asset::{uuid_handle, RenderAssetUsages};
use bevy::camera::primitives::Aabb;
use bevy::camera::visibility::{NoAutoAabb, NoFrustumCulling};
use bevy::light::NotShadowCaster;
use bevy::mesh::{Indices, MeshTag, MeshVertexBufferLayoutRef, PrimitiveTopology};
use bevy::pbr::{MaterialPipeline, MaterialPipelineKey};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, RenderPipelineDescriptor, ShaderType, SpecializedMeshPipelineError};
use bevy::render::storage::ShaderBuffer;
use bevy::shader::ShaderRef;

pub struct FxPlugin;

impl Plugin for FxPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(MaterialPlugin::<FxMaterial>::default());
        app.world_mut()
            .resource_mut::<Assets<Shader>>()
            .insert(FX_SHADER.id(), Shader::from_wesl(include_str!("../assets/shaders/fx.wesl"), "shaders/fx.wesl"))
            .expect("fx shader");
        app.init_resource::<Fx>()
            .add_systems(Startup, setup_fx)
            // after the ships moved and took their damage: shields follow this frame's position, blasts and
            // hits of this frame show this frame
            .add_systems(
                Update,
                (fx_messages, fx_damage, fx_simulate)
                    .chain()
                    .after(crate::flight::FlightSet::Collide)
                    .after(crate::weapons::WeaponsSet::Dying)
                    .run_if(in_state(AppState::Flight)),
            )
            // the shot-down wingman's jump-out (weapons.rs marks it and removes the ship in WeaponsSet::Dying)
            .add_systems(
                Update,
                fx_jump_outs.after(crate::weapons::WeaponsSet::Damage).before(crate::weapons::WeaponsSet::Dying).run_if(in_state(AppState::Flight)),
            )
            .add_systems(Update, (attach_plumes, drive_plumes).chain())
            .add_systems(PostUpdate, fx_upload.after(TransformSystems::Propagate))
            .add_systems(OnExit(AppState::Flight), fx_clear);
        if let Some(test) = FxTest::from_env() {
            app.insert_resource(test).add_systems(Update, fx_test.before(fx_messages).run_if(in_state(AppState::Flight)));
        }
    }
}

// ---------- tuning ----------

/// web colour values -> Bevy HDR (three.js' ACES pre-exposure, see render.rs light-scale notes)
const GAIN: f32 = 1.6;
/// web point-sprite size -> world radius of the camera-facing quad (600 px scale at 1080 px, ~70 deg fov)
const POINT: f32 = 0.39;

const N_FIRE: usize = 2400;
const N_FLASH: usize = 28;
const N_LENS: usize = 6;
const N_DEBRIS: usize = 56;
const N_GLOW: usize = N_FIRE + N_FLASH + N_LENS + N_DEBRIS;
const N_SMOKE: usize = 1000;
const N_STREAK: usize = 640;
const RIB_N: usize = 22;
const RIB_MAX: usize = 64;
const RIB_STEP: f32 = 1.0 / 36.0;
const RIB_LIFE: f32 = (RIB_N - 2) as f32 * RIB_STEP;
const N_FIREBALL: usize = 32;
const N_RING: usize = 16;
/// of which flat plasma ring waves
const N_WAVE: usize = 4;
const N_SHIELD: usize = 10;
const N_LIGHT: usize = 4;
const N_PENDING: usize = 16;
const SHIELD_LIFE: f32 = 0.6;
/// ribbons are only fed this close to the camera
const RIB_RANGE: f32 = 1800.0;

const C_FLASH: Vec3 = Vec3::new(3.2, 2.4, 1.6);
const C_LENS: Vec3 = Vec3::new(1.5, 1.05, 0.75);
const C_SHOCK: Vec3 = Vec3::new(1.0, 0.68, 0.45);
const C_PRAXIS: Vec3 = Vec3::new(1.0, 1.6, 3.0);
const C_LIGHT: Vec3 = Vec3::new(1.0, 0.86, 0.66);
const C_COOL: Vec3 = Vec3::new(1.0, 0.38, 0.1);
const C_EMBER: Vec3 = Vec3::new(2.4, 0.9, 0.3);
const C_SPARK: Vec3 = Vec3::new(3.0, 1.8, 0.6);
const C_BOOM: Vec3 = Vec3::new(2.0, 1.5, 1.0);

/// drive colours (web palette glow): Union blue-white, Aszendenz magenta, Archon gold
const DRIVE: [Vec3; 3] = [Vec3::new(0.5, 1.6, 4.0), Vec3::new(4.0, 0.35, 1.3), Vec3::new(4.0, 1.6, 0.3)];

const FX_SHADER: Handle<Shader> = uuid_handle!("c4f1a3e2-7b9d-4e15-8a2c-5d6e7f809a1b");

// ---------- material ----------

#[derive(Clone, Copy, Debug, Default, ShaderType)]
pub struct FxUniform {
    pub mode: u32,
    pub gain: f32,
    pub p0: f32,
    pub p1: f32,
    pub color: Vec4,
    pub hot: Vec4,
}

/// The effects material: `u.mode` selects the effect (see fx.wesl), `particles` holds the instances of the
/// particle modes (a one-element dummy for the shape modes).
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct FxMaterial {
    #[uniform(0)]
    pub u: FxUniform,
    #[storage(1, read_only)]
    pub particles: Handle<ShaderBuffer>,
}

impl Material for FxMaterial {
    fn vertex_shader() -> ShaderRef {
        ShaderRef::Handle(FX_SHADER)
    }
    fn fragment_shader() -> ShaderRef {
        ShaderRef::Handle(FX_SHADER)
    }
    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Premultiplied
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
    fn specialize(_: &MaterialPipeline, descriptor: &mut RenderPipelineDescriptor, _: &MeshVertexBufferLayoutRef, _: MaterialPipelineKey<Self>) -> Result<(), SpecializedMeshPipelineError> {
        // billboards, double-sided rings and shells: no back-face culling
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}

mod mode {
    pub const GLOW: u32 = 0;
    pub const SMOKE: u32 = 1;
    pub const STREAK: u32 = 2;
    pub const FIREBALL: u32 = 3;
    pub const RING: u32 = 4;
    pub const SHIELD: u32 = 5;
    pub const PLUME: u32 = 6;
    pub const RIBBON: u32 = 7;
}

// ---------- small random generator ----------

#[derive(Clone, Copy)]
struct Rng(u64);

impl Rng {
    fn f(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 40) as f32 / (1u64 << 24) as f32
    }
    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f()
    }
    fn dir(&mut self) -> Vec3 {
        let z = self.range(-1.0, 1.0);
        let a = self.f() * std::f32::consts::TAU;
        let r = (1.0 - z * z).max(0.0).sqrt();
        Vec3::new(r * a.cos(), r * a.sin(), z)
    }
    fn quat(&mut self) -> Quat {
        Quat::from_euler(EulerRot::YXZ, self.f() * 6.283, self.f() * 6.283, self.f() * 6.283)
    }
}

// ---------- pools ----------

/// fire point / smoke puff
#[derive(Clone, Copy, Default)]
struct Pt {
    pos: Vec3,
    vel: Vec3,
    base: Vec3,
    life: f32,
    max: f32,
    size0: f32,
    grow: f32,
    alpha: f32,
    drag: f32,
    heat: f32,
    seed: f32,
}

/// spark / ember streak
#[derive(Clone, Copy, Default)]
struct Streak {
    pos: Vec3,
    vel: Vec3,
    base: Vec3,
    life: f32,
    max: f32,
    drag: f32,
    len: f32,
    w0: f32,
    cool: bool,
}

/// flash or lens streak sprite
#[derive(Clone, Copy, Default)]
struct Sprite {
    pos: Vec3,
    color: Vec3,
    life: f32,
    max: f32,
    size: f32,
}

struct Fireball {
    e: Entity,
    on: bool,
    t: f32,
    life: f32,
    r: f32,
    spin: f32,
    rot: Quat,
    pos: Vec3,
    seed: u32,
    hot: f32,
}

struct Ring {
    e: Entity,
    pos: Vec3,
    rot: Quat,
    life: f32,
    max: f32,
    size: f32,
    width: f32,
    seed: u32,
    bill: bool,
    praxis: bool,
}

struct Shield {
    e: Entity,
    rot: Quat,
    scale: f32,
    /// team and lattice scale bits of the MeshTag
    bits: u32,
    life: f32,
    ship: Entity,
    k0: f32,
    k: f32,
}

struct Debris {
    e: Entity,
    pos: Vec3,
    vel: Vec3,
    spin: Vec3,
    rot: Quat,
    scale: f32,
    life: f32,
    max: f32,
}

struct Light {
    e: Entity,
    pos: Vec3,
    life: f32,
    max: f32,
    peak: f32,
    c0: Vec3,
    cool: bool,
}

#[derive(Clone, Copy, Default)]
struct Pending {
    pos: Vec3,
    size: f32,
    t: f32,
    on: bool,
}

/// One exhaust ribbon: points newest first.
#[derive(Clone, Copy)]
struct RibPoint {
    pos: Vec3,
    dir: Vec3,
    t0: f32,
    width: f32,
    col: Vec3,
}

const DEAD: f32 = -1e6;

impl Default for RibPoint {
    fn default() -> Self {
        Self { pos: Vec3::ZERO, dir: Vec3::Z, t0: DEAD, width: 0.0, col: Vec3::ZERO }
    }
}

struct Ribbon {
    pts: [RibPoint; RIB_N],
    owner: Option<Entity>,
    fed: u32,
    acc: f32,
    born: f32,
    pri: bool,
}

impl Default for Ribbon {
    fn default() -> Self {
        Self { pts: [RibPoint::default(); RIB_N], owner: None, fed: 0, acc: 0.0, born: 0.0, pri: false }
    }
}

/// A particle system drawn from one storage buffer.
struct GpuSystem {
    entity: Entity,
    buffer: Handle<ShaderBuffer>,
    staging: Vec<[f32; 4]>,
    dirty: bool,
}

impl GpuSystem {
    fn put(&mut self, i: usize, pos: Vec3, size: f32, color: [f32; 4], ext: [f32; 4]) {
        let o = i * 3;
        self.staging[o] = [pos.x, pos.y, pos.z, size];
        self.staging[o + 1] = color;
        self.staging[o + 2] = ext;
    }
    fn kill(&mut self, i: usize) {
        self.staging[i * 3] = [0.0; 4];
    }
}

/// All effect pools (owner: fx.rs).
#[derive(Resource)]
pub struct Fx {
    rng: Rng,
    ready: bool,
    time: f32,
    frame: u32,
    fire: Vec<Pt>,
    fire_cur: usize,
    smoke: Vec<Pt>,
    smoke_cur: usize,
    streaks: Vec<Streak>,
    streak_cur: usize,
    flashes: [Sprite; N_FLASH],
    lenses: [Sprite; N_LENS],
    fireballs: Vec<Fireball>,
    rings: Vec<Ring>,
    shields: Vec<Shield>,
    debris: Vec<Debris>,
    debris_cur: usize,
    lights: Vec<Light>,
    pending: [Pending; N_PENDING],
    ribbons: Vec<Ribbon>,
    glow: Option<GpuSystem>,
    smoke_gpu: Option<GpuSystem>,
    streak_gpu: Option<GpuSystem>,
    ribbon_gpu: Option<GpuSystem>,
    smoke_order: Vec<(f32, u16)>,
    live: bool,
    /// slow motion for the test hook (SF_FX_SLOW)
    time_scale: f32,
}

impl Default for Fx {
    fn default() -> Self {
        Self {
            rng: Rng(0x9e37_79b9_7f4a_7c15),
            ready: false,
            time: 0.0,
            frame: 0,
            fire: vec![Pt::default(); N_FIRE],
            fire_cur: 0,
            smoke: vec![Pt::default(); N_SMOKE],
            smoke_cur: 0,
            streaks: vec![Streak::default(); N_STREAK],
            streak_cur: 0,
            flashes: [Sprite::default(); N_FLASH],
            lenses: [Sprite::default(); N_LENS],
            fireballs: Vec::new(),
            rings: Vec::new(),
            shields: Vec::new(),
            debris: Vec::new(),
            debris_cur: 0,
            lights: Vec::new(),
            pending: [Pending::default(); N_PENDING],
            ribbons: (0..RIB_MAX).map(|_| Ribbon::default()).collect(),
            glow: None,
            smoke_gpu: None,
            streak_gpu: None,
            ribbon_gpu: None,
            smoke_order: Vec::with_capacity(N_SMOKE),
            time_scale: std::env::var("SF_FX_SLOW").ok().and_then(|s| s.parse::<f32>().ok()).unwrap_or(1.0),
            live: false,
        }
    }
}

/// Shared handles for engine plumes (spawned whenever a ship model appears).
#[derive(Resource)]
struct PlumeAssets {
    mesh: Handle<Mesh>,
    mats: [Handle<FxMaterial>; 3],
}

/// Engine plume on an `EngineNozzle` (child entity of the nozzle).
#[derive(Component)]
pub struct Plume {
    /// root entity of the ship (carries `Ship` in missions)
    owner: Entity,
    /// web exhaust base size: nozzle radius x 4
    base: f32,
    radius: f32,
    color: usize,
    ribbon: Option<usize>,
}

// ---------- setup ----------

fn quad_strip(n: usize) -> Mesh {
    let mut pos = Vec::with_capacity(n * 4);
    let mut idx = Vec::with_capacity(n * 6);
    for i in 0..n {
        let f = i as f32;
        for (x, y) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
            pos.push([f, x, y]);
        }
        let b = (i * 4) as u32;
        idx.extend_from_slice(&[b, b + 1, b + 2, b + 2, b + 1, b + 3]);
    }
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos).with_inserted_indices(Indices::U32(idx))
}

fn ribbon_strip() -> Mesh {
    let mut pos = Vec::with_capacity(RIB_MAX * RIB_N * 2);
    let mut idx = Vec::with_capacity(RIB_MAX * (RIB_N - 1) * 6);
    for r in 0..RIB_MAX {
        for i in 0..RIB_N {
            let f = (r * RIB_N + i) as f32;
            pos.push([f, -1.0, 0.0]);
            pos.push([f, 1.0, 0.0]);
        }
        for i in 0..RIB_N - 1 {
            let a = ((r * RIB_N + i) * 2) as u32;
            idx.extend_from_slice(&[a, a + 1, a + 2, a + 1, a + 3, a + 2]);
        }
    }
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD).with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos).with_inserted_indices(Indices::U32(idx))
}

fn plume_mesh() -> Mesh {
    let pos: Vec<[f32; 3]> = vec![
        [-0.1, -1.0, 0.0],
        [-0.1, 1.0, 0.0],
        [1.0, -1.0, 0.0],
        [1.0, 1.0, 0.0],
        [-1.0, -1.0, 1.0],
        [1.0, -1.0, 1.0],
        [-1.0, 1.0, 1.0],
        [1.0, 1.0, 1.0],
    ];
    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, pos)
        .with_inserted_indices(Indices::U32(vec![0, 2, 1, 1, 2, 3, 4, 5, 6, 6, 5, 7]))
}

fn positions_only(mut m: Mesh) -> Mesh {
    m.remove_attribute(Mesh::ATTRIBUTE_NORMAL);
    m.remove_attribute(Mesh::ATTRIBUTE_UV_0);
    m.remove_attribute(Mesh::ATTRIBUTE_TANGENT);
    m
}

fn hot_of(c: Vec3) -> Vec3 {
    let m = c.max_element();
    c * 0.45 + Vec3::splat(m * 0.55)
}

fn uniform(mode: u32, color: Vec3, hot: Vec3, p0: f32) -> FxUniform {
    FxUniform { mode, gain: GAIN, p0, p1: 0.0, color: color.extend(1.0), hot: hot.extend(1.0) }
}

#[allow(clippy::too_many_arguments)]
fn setup_fx(
    mut commands: Commands,
    mut fx: ResMut<Fx>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut mats: ResMut<Assets<FxMaterial>>,
    mut std_mats: ResMut<Assets<StandardMaterial>>,
    mut buffers: ResMut<Assets<ShaderBuffer>>,
) {
    let dummy = buffers.add(ShaderBuffer::new(vec![[0.0f32; 4]; 3], RenderAssetUsages::RENDER_WORLD));
    let mut system = |n: usize, mesh: Mesh, u: FxUniform, commands: &mut Commands| -> GpuSystem {
        let buffer = buffers.add(ShaderBuffer::new(vec![[0.0f32; 4]; n * 3], RenderAssetUsages::RENDER_WORLD));
        let mat = mats.add(FxMaterial { u, particles: buffer.clone() });
        let entity = commands
            .spawn((
                Mesh3d(meshes.add(mesh)),
                MeshMaterial3d(mat),
                Transform::default(),
                Visibility::Hidden,
                NoFrustumCulling,
                NotShadowCaster,
                FxSystem,
                Aabb::from_min_max(Vec3::splat(-1.0), Vec3::splat(1.0)),
                Name::new("Fx-Partikel"),
            ))
            .id();
        GpuSystem { entity, buffer, staging: vec![[0.0; 4]; n * 3], dirty: false }
    };
    fx.glow = Some(system(N_GLOW, quad_strip(N_GLOW), uniform(mode::GLOW, Vec3::ONE, Vec3::ONE, 0.0), &mut commands));
    fx.smoke_gpu = Some(system(N_SMOKE, quad_strip(N_SMOKE), uniform(mode::SMOKE, Vec3::ONE, Vec3::ONE, 0.0), &mut commands));
    fx.streak_gpu = Some(system(N_STREAK, quad_strip(N_STREAK), uniform(mode::STREAK, Vec3::ONE, Vec3::ONE, 0.0), &mut commands));
    fx.ribbon_gpu = Some(system(RIB_MAX * RIB_N, ribbon_strip(), uniform(mode::RIBBON, Vec3::ONE, Vec3::ONE, 0.3), &mut commands));

    let shape = |mode: u32, color: Vec3, mats: &mut Assets<FxMaterial>| mats.add(FxMaterial { u: uniform(mode, color, hot_of(color), 0.0), particles: dummy.clone() });
    let pool_entity = |commands: &mut Commands, mesh: &Handle<Mesh>, mat: &Handle<FxMaterial>, aabb: Aabb, name: &'static str| {
        commands
            .spawn((Mesh3d(mesh.clone()), MeshMaterial3d(mat.clone()), MeshTag::new(0), Transform::default(), Visibility::Hidden, NotShadowCaster, NoAutoAabb, aabb, FxPooled, Name::new(name)))
            .id()
    };

    // fireballs: displaced icospheres
    let ball = meshes.add(positions_only(Sphere::new(1.0).mesh().ico(3).expect("icosphere")));
    let ball_mat = shape(mode::FIREBALL, Vec3::ONE, &mut mats);
    fx.fireballs = (0..N_FIREBALL)
        .map(|_| Fireball {
            e: pool_entity(&mut commands, &ball, &ball_mat, Aabb::from_min_max(Vec3::splat(-1.5), Vec3::splat(1.5)), "Fx-Feuerball"),
            on: false,
            t: 0.0,
            life: 1.0,
            r: 1.0,
            spin: 0.0,
            rot: Quat::IDENTITY,
            pos: Vec3::ZERO,
            seed: 0,
            hot: 1.0,
        })
        .collect();

    // rings: shockwave (camera-facing) and the capitals' flat plasma wave
    let quad = meshes.add(
        Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::RENDER_WORLD)
            .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, vec![[-1.0f32, -1.0, 0.0], [1.0, -1.0, 0.0], [-1.0, 1.0, 0.0], [1.0, 1.0, 0.0]])
            .with_inserted_indices(Indices::U32(vec![0, 1, 2, 2, 1, 3])),
    );
    let ring_mats = [shape(mode::RING, C_SHOCK, &mut mats), shape(mode::RING, C_PRAXIS, &mut mats)];
    fx.rings = (0..N_RING)
        .map(|i| {
            let praxis = i >= N_RING - N_WAVE;
            Ring {
                e: pool_entity(&mut commands, &quad, &ring_mats[praxis as usize], Aabb::from_min_max(Vec3::splat(-1.0), Vec3::splat(1.0)), "Fx-Ring"),
                pos: Vec3::ZERO,
                rot: Quat::IDENTITY,
                life: 0.0,
                max: 1.0,
                size: 1.0,
                width: 0.1,
                seed: 0,
                bill: !praxis,
                praxis,
            }
        })
        .collect();

    // shield ripples
    let bubble = meshes.add(positions_only(Sphere::new(1.0).mesh().ico(4).expect("icosphere")));
    let shield_mat = shape(mode::SHIELD, Vec3::ONE, &mut mats);
    fx.shields = (0..N_SHIELD)
        .map(|_| Shield {
            e: pool_entity(&mut commands, &bubble, &shield_mat, Aabb::from_min_max(Vec3::splat(-1.05), Vec3::splat(1.05)), "Fx-Schild"),
            rot: Quat::IDENTITY,
            scale: 1.0,
            bits: 0,
            life: 0.0,
            ship: Entity::PLACEHOLDER,
            k0: 0.0,
            k: 0.0,
        })
        .collect();

    // tumbling hull fragments (lit metal; their heat glow is a glow particle)
    let shapes = [meshes.add(Tetrahedron::default().mesh()), meshes.add(Cuboid::new(1.6, 0.4, 1.0).mesh()), meshes.add(Sphere::new(0.9).mesh().ico(0).expect("icosahedron"))];
    let metal = std_mats.add(StandardMaterial { base_color: Color::srgb_u8(0x3a, 0x3a, 0x40), metallic: 0.8, perceptual_roughness: 0.45, emissive: LinearRgba::rgb(0.25, 0.06, 0.01), ..default() });
    fx.debris = (0..N_DEBRIS)
        .map(|i| Debris {
            e: commands.spawn((Mesh3d(shapes[i % 3].clone()), MeshMaterial3d(metal.clone()), Transform::default(), Visibility::Hidden, FxPooled, Name::new("Fx-Trümmer"))).id(),
            pos: Vec3::ZERO,
            vel: Vec3::ZERO,
            spin: Vec3::ZERO,
            rot: Quat::IDENTITY,
            scale: 1.0,
            life: 0.0,
            max: 1.0,
        })
        .collect();

    // explosion light: a fixed number of point lights, hidden while idle
    fx.lights = (0..N_LIGHT)
        .map(|_| Light {
            e: commands
                .spawn((PointLight { intensity: 0.0, range: 900.0, radius: 4.0, shadow_maps_enabled: false, ..default() }, Transform::default(), Visibility::Hidden, FxPooled, Name::new("Fx-Licht")))
                .id(),
            pos: Vec3::ZERO,
            life: 0.0,
            max: 1.0,
            peak: 0.0,
            c0: C_LIGHT,
            cool: false,
        })
        .collect();

    let plume = PlumeAssets {
        mesh: meshes.add(plume_mesh()),
        mats: [shape(mode::PLUME, DRIVE[0], &mut mats), shape(mode::PLUME, DRIVE[1], &mut mats), shape(mode::PLUME, DRIVE[2], &mut mats)],
    };
    commands.insert_resource(plume);
    fx.ready = true;
}

// ---------- spawning primitives (ports of src/fx.js) ----------

impl Fx {
    #[allow(clippy::too_many_arguments)]
    fn fire_add(&mut self, pos: Vec3, vel: Vec3, base: Vec3, size: f32, life: f32, drag: f32, grow: f32, alpha: f32) {
        let i = self.fire_cur;
        self.fire_cur = (self.fire_cur + 1) % N_FIRE;
        self.fire[i] = Pt { pos, vel, base, life, max: life, size0: size, grow, alpha, drag, heat: 0.0, seed: 0.0 };
        self.live = true;
    }

    /// glowing point that cools white -> orange -> red (engine sparks, flame tongues, ember trails)
    fn particle(&mut self, pos: Vec3, vel: Vec3, base: Vec3, size: f32, life: f32, drag: f32) {
        self.fire_add(pos, vel, base, size, life, drag, 0.0, 1.0);
    }

    #[allow(clippy::too_many_arguments)]
    fn smoke(&mut self, pos: Vec3, size: f32, life: f32, vel: Vec3, shade: f32, alpha: f32, heat: f32) {
        let i = self.smoke_cur;
        self.smoke_cur = (self.smoke_cur + 1) % N_SMOKE;
        let j = Vec3::new(self.rng.range(-4.0, 4.0), self.rng.range(-4.0, 4.0), self.rng.range(-4.0, 4.0));
        let seed = self.rng.f();
        self.smoke[i] = Pt {
            pos,
            vel: vel + j,
            base: Vec3::new(shade, shade * 0.95, shade * 0.92),
            life,
            max: life,
            size0: size,
            grow: size * 2.2,
            alpha,
            drag: 0.6,
            heat,
            seed,
        };
        self.live = true;
    }

    #[allow(clippy::too_many_arguments)]
    fn streak(&mut self, pos: Vec3, vel: Vec3, base: Vec3, w: f32, life: f32, drag: f32, len: f32, cool: bool) {
        let i = self.streak_cur;
        self.streak_cur = (self.streak_cur + 1) % N_STREAK;
        self.streaks[i] = Streak { pos, vel, base, life, max: life, drag, len, w0: w, cool };
        self.live = true;
    }

    fn flash(&mut self, pos: Vec3, size: f32, color: Vec3, life: f32) {
        let i = self.flashes.iter().position(|f| f.life <= 0.0).unwrap_or_else(|| {
            // all busy: replace the one closest to its end
            self.flashes.iter().enumerate().min_by(|a, b| a.1.life.total_cmp(&b.1.life)).map_or(0, |x| x.0)
        });
        self.flashes[i] = Sprite { pos, color, life, max: life, size };
        self.live = true;
    }

    fn lens(&mut self, pos: Vec3, size: f32, color: Vec3, life: f32) {
        let i = self.lenses.iter().position(|f| f.life <= 0.0).unwrap_or(0);
        self.lenses[i] = Sprite { pos, color, life, max: life, size };
        self.live = true;
    }

    /// expanding ring; `praxis` = the capitals' flat plasma wave (oriented by `axis`), else a shockwave
    #[allow(clippy::too_many_arguments)]
    fn ring(&mut self, pos: Vec3, size: f32, praxis: bool, life: f32, bill: bool, width: f32, axis: Option<Vec3>) {
        let mut pick = None;
        let mut oldest = f32::INFINITY;
        for (i, r) in self.rings.iter().enumerate().filter(|(_, r)| r.praxis == praxis) {
            if r.life <= 0.0 {
                pick = Some(i);
                break;
            }
            if r.life < oldest {
                oldest = r.life;
                pick = Some(i);
            }
        }
        let Some(i) = pick else { return };
        let rot = match axis {
            Some(a) => Quat::from_rotation_arc(Vec3::Z, a.normalize_or(Vec3::Y)),
            None => self.rng.quat(),
        };
        let seed = (self.rng.f() * 255.0) as u32;
        let r = &mut self.rings[i];
        *r = Ring { e: r.e, pos, rot, life, max: life, size, width, seed, bill, praxis };
        self.live = true;
    }

    fn light(&mut self, pos: Vec3, peak: f32, life: f32, color: Vec3, cool: bool) {
        // take the one closest to its end
        let i = self.lights.iter().enumerate().min_by(|a, b| a.1.life.total_cmp(&b.1.life)).map_or(0, |x| x.0);
        let l = &mut self.lights[i];
        l.life = life;
        l.max = life;
        l.peak = peak;
        l.c0 = color;
        l.cool = cool;
        l.pos = pos;
        self.live = true;
    }

    fn fireball(&mut self, pos: Vec3, r: f32, life: f32, delay: f32, hot: f32) {
        let mut pick = 0;
        let mut best = f32::NEG_INFINITY;
        for (i, f) in self.fireballs.iter().enumerate() {
            if !f.on {
                pick = i;
                break;
            }
            // recycle the most burnt-out one, sparing balls much bigger than the new one
            let a = f.t / f.life - if f.r > r * 1.5 { 0.6 } else { 0.0 };
            if a > best {
                best = a;
                pick = i;
            }
        }
        let spin = self.rng.range(-0.4, 0.4);
        let rot = self.rng.quat();
        let seed = (self.rng.f() * 255.0) as u32;
        let f = &mut self.fireballs[pick];
        f.on = true;
        f.t = -delay;
        f.life = life;
        f.r = r;
        f.spin = spin;
        f.rot = rot;
        f.pos = pos;
        f.seed = seed;
        f.hot = hot;
        self.live = true;
    }

    /// glowing embers / sparks with motion-blur trails
    #[allow(clippy::too_many_arguments)]
    fn embers(&mut self, pos: Vec3, n: usize, speed: f32, color: Vec3, w: f32, life: f32, drag: f32, len: f32, cool: bool) {
        for _ in 0..n {
            let d = self.rng.dir();
            let sp = speed * self.rng.range(0.25, 1.0);
            let ww = w * self.rng.range(0.6, 1.2);
            let ll = life * self.rng.range(0.5, 1.3);
            self.streak(pos, d * sp, color, ww, ll, drag, len, cool);
        }
    }

    fn sparks(&mut self, pos: Vec3, color: Vec3, n: usize, speed: f32) {
        for _ in 0..n {
            let d = self.rng.dir();
            let sp = speed * self.rng.range(0.3, 1.3);
            let life = self.rng.range(0.25, 0.55);
            self.streak(pos, d * sp, color, 0.22, life, 1.0, 0.045, false);
        }
    }

    fn fragments(&mut self, pos: Vec3, n: usize, speed: f32, size: f32) {
        for _ in 0..n {
            let i = self.debris_cur;
            self.debris_cur = (self.debris_cur + 1) % N_DEBRIS;
            let vel = self.rng.dir() * speed * self.rng.range(0.3, 1.3);
            let spin = Vec3::new(self.rng.range(-4.0, 4.0), self.rng.range(-4.0, 4.0), self.rng.range(-4.0, 4.0));
            let rot = self.rng.quat();
            let scale = size * self.rng.range(0.4, 1.4);
            let life = self.rng.range(1.6, 3.2);
            let d = &mut self.debris[i];
            d.pos = pos;
            d.vel = vel;
            d.spin = spin;
            d.rot = rot;
            d.scale = scale;
            d.life = life;
            d.max = life;
        }
        self.live = true;
    }

    /// hexagonal energy ripple on a ship's bubble, centred where the shot landed
    fn shield(&mut self, ship: Entity, ship_pos: Vec3, radius: f32, team: Team, capital: bool, point: Vec3) {
        // at most 2 slots per ship: re-aim its newest ripple if that one is still fresh, else a second one
        let mut own: Option<usize> = None;
        let mut own2: Option<usize> = None;
        for (i, s) in self.shields.iter().enumerate() {
            if s.life <= 0.0 || s.ship != ship {
                continue;
            }
            match own {
                Some(o) if s.life <= self.shields[o].life => own2 = Some(i),
                _ => {
                    own2 = own;
                    own = Some(i);
                }
            }
        }
        let fresh = |i: usize, s: &[Shield]| SHIELD_LIFE - s[i].life < 0.2;
        let mut pick = match (own, own2) {
            (Some(o), Some(o2)) => Some(if fresh(o, &self.shields) { o } else { o2 }),
            (Some(o), None) if fresh(o, &self.shields) => Some(o),
            _ => None,
        };
        if pick.is_none() {
            pick = self.shields.iter().position(|s| s.life <= 0.0).or_else(|| self.shields.iter().enumerate().min_by(|a, b| a.1.life.total_cmp(&b.1.life)).map(|x| x.0));
        }
        let Some(i) = pick else { return };
        let s = &mut self.shields[i];
        // a re-aimed ripple starts from its current brightness instead of blinking out for the fade-in
        s.k0 = if s.life > 0.0 && s.ship == ship { s.k.min(1.0) } else { 0.0 };
        s.ship = ship;
        s.life = SHIELD_LIFE;
        let hit = (point - ship_pos).normalize_or(Vec3::Z);
        s.rot = Quat::from_rotation_arc(Vec3::Z, hit);
        s.scale = radius * if capital { 1.0 } else { 1.35 };
        let team: u32 = match team {
            Team::Union => 0,
            Team::Aszendenz => 1,
            Team::Neutral => 2,
        };
        let lattice: u32 = if capital { 11 } else { 6 };
        s.bits = (team << 18) | (lattice << 20);
        self.live = true;
    }

    /// The explosion recipe of the web game: flash + lens streak + light, fireball(s), flame tongues, embers,
    /// smoke lit from inside, hull fragments, shockwave; capitals add a flat plasma ring and secondary blasts.
    fn explode(&mut self, p: Vec3, size: f32) {
        let big = size >= 3.0;
        let r_ball = 6.0 + 9.0 * size;
        let life = (1.3 + 0.24 * size).min(3.4);
        // sizes capped: a capital kill must not white out the screen (fireball and rings carry the scale);
        // the 0.13 s pops of a dying capital ship are capped harder, they overlap
        let fs = if (1.5..6.0).contains(&size) { size.min(2.5) } else { size.min(4.0) };
        self.flash(p, 45.0 * fs, C_FLASH, 0.22);
        self.lens(p, 110.0 * fs, C_LENS, 0.3 + fs * 0.04);
        self.light(p, (6.0e7 * size * size).min(2.5e9), 0.5 + size * 0.1, C_LIGHT, true);
        self.fireball(p, r_ball, life, 0.0, if size >= 6.0 { 0.85 } else { 1.05 });
        let lobes = if size >= 6.0 {
            4
        } else if size >= 1.5 {
            0
        } else {
            2
        };
        for _ in 0..lobes {
            let o = p + self.rng.dir() * r_ball * self.rng.range(0.45, 0.75);
            let rr = r_ball * self.rng.range(0.4, 0.65);
            let ll = life * self.rng.range(0.65, 0.9);
            let dl = self.rng.f() * if big { 0.25 } else { 0.08 };
            self.fireball(o, rr, ll, dl, 1.05);
        }
        // flame tongues licking out of the fireball
        let n = (10.0 + size * 6.0).min(50.0) as usize;
        for _ in 0..n {
            let d = self.rng.dir();
            let sp = self.rng.range(30.0, 90.0) * (0.6 + size * 0.35);
            let base = Vec3::new(1.9, self.rng.range(0.75, 1.25), self.rng.range(0.2, 0.4));
            let sz = self.rng.range(3.0, 8.0) * (0.7 + size * 0.3);
            let lf = self.rng.range(0.3, 0.8);
            self.fire_add(p + d * r_ball * 0.3, d * sp, base, sz, lf, 2.4, 3.0 * size, 1.0);
        }
        // glowing embers with short trails
        // (the pops of a dying capital ship come every 0.13 s: fewer embers each)
        let pop = if (1.5..6.0).contains(&size) { 0.5 } else { 1.0 };
        let ne = ((18.0 + size * 8.0).min(80.0) * pop) as usize;
        let sp = self.rng.range(140.0, 260.0) * (0.6 + size * 0.3);
        self.embers(p, ne, sp, C_FLASH, 0.35 + size * 0.08, 1.4 + size * 0.1, 0.5, 0.06, true);
        // smoke, lit orange from inside at first, lingering after the fire is gone
        let sm = (6.0 + size * 6.0).min(26.0) as usize;
        for _ in 0..sm {
            let at = p + self.rng.dir() * r_ball * 0.35;
            let v = self.rng.dir() * (8.0 + self.rng.f() * 18.0 * size);
            let sz = self.rng.range(5.0, 11.0) * size;
            let lf = self.rng.range(2.2, 4.6);
            let shade = self.rng.range(0.07, 0.13);
            let heat = self.rng.range(0.5, 1.0);
            self.smoke(at, sz, lf, v, shade, 0.65, heat);
        }
        // hull fragments and a crisp shockwave
        self.fragments(p, (3.0 + size * 3.0).min(14.0) as usize, 60.0 + size * 30.0, 0.8 + size * 0.5);
        // (a dying capital ship pops every 0.13 s: only some of those blasts get a shockwave)
        if size < 1.5 || size >= 6.0 || self.rng.f() < 0.35 {
            self.ring(p, 34.0 * size, false, 0.45 + size * 0.05, true, 0.09, None);
        }
        // a capital kill's final blast: a flat, Star-Trek-like plasma ring wave (tilted, rarely edge-on), as on the web
        if size >= 6.0 {
            let axis = Vec3::new(self.rng.range(-0.8, 0.8), 1.0, self.rng.range(-0.8, 0.8)).normalize();
            self.ring(p, 120.0 * size, true, 1.6, false, 0.3, Some(axis));
        }
        if size >= 6.0 {
            // the final blast: a big white flash and secondary blasts rippling through the wreck
            self.flash(p, 220.0, C_BOOM, 0.25);
            for _ in 0..7 {
                let Some(q) = self.pending.iter().position(|q| !q.on) else { break };
                let t = self.rng.range(0.12, 1.22);
                let s = size * self.rng.range(0.22, 0.37);
                let at = p + self.rng.dir() * r_ball * self.rng.range(0.4, 1.3);
                self.pending[q] = Pending { pos: at, size: s, t, on: true };
            }
        }
    }

    /// hull breach: sparks plus a puff of dark smoke
    fn hull_hit(&mut self, p: Vec3, color: Vec3) {
        self.sparks(p, color, 10, 80.0);
        self.smoke(p, 3.0, 1.2, Vec3::ZERO, 0.12, 0.5, 0.6);
    }

    /// Ribbon for plume `id` of priority `pri` (the player's): a free one, else the fading one closest to its
    /// end, else (priority only) the oldest live ribbon of a non-priority engine.
    fn claim_ribbon(&mut self, owner: Entity, pri: bool) -> Option<usize> {
        let frame = self.frame;
        let mut id = self.ribbons.iter().position(|r| r.owner.is_none());
        if id.is_none() {
            let mut best = f32::INFINITY;
            for (i, r) in self.ribbons.iter().enumerate() {
                if r.fed == frame || r.fed + 1 == frame {
                    continue;
                }
                if r.pts[0].t0 < best {
                    best = r.pts[0].t0;
                    id = Some(i);
                }
            }
        }
        if id.is_none() && pri {
            let mut best = f32::INFINITY;
            for (i, r) in self.ribbons.iter().enumerate() {
                if !r.pri && r.born < best {
                    best = r.born;
                    id = Some(i);
                }
            }
        }
        let i = id?;
        let r = &mut self.ribbons[i];
        r.owner = Some(owner);
        r.born = self.time;
        r.pri = pri;
        Some(i)
    }

    /// Engine `owner` (plume entity) is at `p` this frame; `ribbon` is its cached ribbon index.
    fn feed_ribbon(&mut self, ribbon: &mut Option<usize>, owner: Entity, p: Vec3, width: f32, col: Vec3, dt: f32, pri: bool) {
        let mut id = ribbon.filter(|&i| self.ribbons[i].owner == Some(owner));
        let mut fresh = id.is_none();
        // a jump (spawn, autopilot) restarts the ribbon instead of a streak across space
        if let Some(i) = id {
            if self.ribbons[i].pts[0].pos.distance_squared(p) > 400.0 * 400.0 {
                fresh = true;
                self.ribbons[i].born = self.time;
            }
        }
        if fresh {
            if id.is_none() {
                id = self.claim_ribbon(owner, pri);
            }
            let Some(i) = id else {
                *ribbon = None;
                return;
            };
            let r = &mut self.ribbons[i];
            for (k, pt) in r.pts.iter_mut().enumerate() {
                *pt = RibPoint { pos: p, dir: Vec3::Z, t0: if k == 0 { self.time } else { DEAD }, width, col };
            }
            r.acc = 0.0;
        }
        let Some(i) = id else { return };
        *ribbon = Some(i);
        let time = self.time;
        let r = &mut self.ribbons[i];
        r.fed = self.frame;
        r.acc += dt;
        if r.acc >= RIB_STEP {
            // freeze the head: shift the strip one point back (newest first)
            r.acc = (r.acc - RIB_STEP).min(RIB_STEP);
            r.pts.copy_within(0..RIB_N - 1, 1);
        }
        // the head follows the nozzle; its direction points back along the ribbon
        let d = p - r.pts[1].pos;
        let dir = if d.length_squared() > 1e-6 { d.normalize() } else { r.pts[1].dir };
        r.pts[0] = RibPoint { pos: p, dir, t0: time, width, col };
        // the newest frozen point turns with the head, so the strip has no kink at the nozzle
        if r.pts[1].t0 > DEAD {
            r.pts[1].dir = dir;
        }
        self.live = true;
    }

    fn clear(&mut self) {
        for p in self.fire.iter_mut().chain(self.smoke.iter_mut()) {
            p.life = 0.0;
        }
        for s in &mut self.streaks {
            s.life = 0.0;
        }
        for s in self.flashes.iter_mut().chain(self.lenses.iter_mut()) {
            s.life = 0.0;
        }
        for f in &mut self.fireballs {
            f.on = false;
        }
        for r in &mut self.rings {
            r.life = 0.0;
        }
        for s in &mut self.shields {
            s.life = 0.0;
        }
        for d in &mut self.debris {
            d.life = 0.0;
        }
        for l in &mut self.lights {
            l.life = 0.0;
        }
        for q in &mut self.pending {
            q.on = false;
        }
        for r in &mut self.ribbons {
            *r = Ribbon::default();
        }
        self.live = true;
    }
}

/// Marker for pooled effect entities (fireballs, rings, shields, debris, lights).
#[derive(Component)]
struct FxPooled;

/// Marker for the particle-system entities (one per storage buffer).
#[derive(Component)]
struct FxSystem;

// ---------- systems ----------

type ShipQuery<'w, 's> = Query<'w, 's, (&'static Transform, &'static Ship, Has<Player>), (Without<FxPooled>, Without<MainCamera>)>;

/// ExplodeMsg / HitFxMsg -> effects.
#[allow(clippy::too_many_arguments)]
fn fx_messages(
    mut fx: ResMut<Fx>,
    mut explode: MessageReader<ExplodeMsg>,
    mut hits: MessageReader<HitFxMsg>,
    ships: ShipQuery,
    cam: Query<&GlobalTransform, With<MainCamera>>,
    mut shake: Option<ResMut<CameraShake>>,
    settings: Res<Settings>,
) {
    if !fx.ready {
        explode.clear();
        hits.clear();
        return;
    }
    let ear = cam.single().ok().map(|c| c.translation());
    for m in explode.read() {
        fx.explode(m.pos, m.size);
        // blasts close to the camera shake it (a capital's final blast from further away)
        if let (Some(ear), Some(shake)) = (ear, shake.as_mut()) {
            let d = ear.distance(m.pos);
            let reach = 120.0 + 90.0 * m.size;
            if d < reach {
                shake.add(0.5 * m.size.min(6.0) * (1.0 - d / reach), 1.2);
            }
        }
    }
    for h in hits.read() {
        let c = Vec3::new(h.color.red, h.color.green, h.color.blue);
        let ship = ships.get(h.ship).ok();
        let own = ship.as_ref().is_some_and(|s| s.2);
        let sc = if own { 0.45 } else { 1.0 };
        if h.shield {
            fx.flash(h.pos, 10.0 * sc, c, 0.15);
            if let Some((tf, s, is_player)) = ship {
                if !is_player {
                    fx.shield(h.ship, tf.translation, s.radius(), s.team, s.capital(), h.pos);
                }
            }
        } else {
            if !(own && settings.view == View::Cockpit) {
                fx.hull_hit(h.pos, c);
            }
            fx.flash(h.pos, 9.0 * sc, c, 0.15);
        }
    }
}

/// Web jumpOut(): a blue flash and a ring where a ship leaves (the shot-down wingman, see weapons.rs).
fn fx_jump_outs(mut fx: ResMut<Fx>, q: Query<&Transform, Added<crate::weapons::JumpedOut>>) {
    if !fx.ready {
        return;
    }
    for tf in &q {
        fx.flash(tf.translation, 120.0, Vec3::new(2.0, 3.0, 5.0), 0.6);
        fx.ring(tf.translation, 40.0, true, 0.6, false, 0.18, None);
    }
}

/// Advance every pool by one frame (frozen while paused) and write the pooled entities.
#[allow(clippy::too_many_arguments)]
fn fx_simulate(
    time: Res<Time>,
    paused: Res<Paused>,
    mut fx: ResMut<Fx>,
    ships: Query<&Transform, (With<Ship>, Without<FxPooled>)>,
    mut pooled: Query<(&mut Transform, &mut Visibility, Option<&mut MeshTag>, Option<&mut PointLight>), With<FxPooled>>,
) {
    if !fx.ready {
        return;
    }
    let dt = if paused.0 { 0.0 } else { time.delta_secs().min(0.05) * fx.time_scale };
    fx.time += dt;
    let fx = &mut *fx;

    // delayed secondary blasts of a dying capital ship
    for i in 0..N_PENDING {
        if !fx.pending[i].on {
            continue;
        }
        fx.pending[i].t -= dt;
        if fx.pending[i].t <= 0.0 {
            fx.pending[i].on = false;
            let (p, s) = (fx.pending[i].pos, fx.pending[i].size);
            fx.explode(p, s);
        }
    }

    // CPU particles
    for p in fx.fire.iter_mut().chain(fx.smoke.iter_mut()) {
        if p.life <= 0.0 {
            continue;
        }
        p.life -= dt;
        let d = (1.0 - p.drag * dt).max(0.0);
        p.vel *= d;
        p.pos += p.vel * dt;
    }
    for s in &mut fx.streaks {
        if s.life <= 0.0 {
            continue;
        }
        s.life -= dt;
        let d = (1.0 - s.drag * dt).max(0.0);
        s.vel *= d;
        s.pos += s.vel * dt;
    }
    for f in fx.flashes.iter_mut().chain(fx.lenses.iter_mut()) {
        f.life -= dt;
    }

    // fireballs
    for f in &mut fx.fireballs {
        let Ok((mut t, mut vis, tag, _)) = pooled.get_mut(f.e) else { continue };
        if !f.on {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        f.t += dt;
        if f.t < 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        let q = f.t / f.life;
        if q >= 1.0 {
            f.on = false;
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        vis.set_if_neq(Visibility::Inherited);
        let e = (q * 1.8).min(1.0);
        let scale = f.r * (0.2 + 0.8 * (1.0 - (1.0 - e).powi(3)) + 0.25 * q);
        f.rot = Quat::from_rotation_y(f.spin * dt) * f.rot;
        *t = Transform { translation: f.pos, rotation: f.rot, scale: Vec3::splat(scale) };
        let fade = ((1.0 - q) * 5.0).min(1.0);
        if let Some(mut tag) = tag {
            tag.value = (q * 1023.0) as u32 | (((fade * 255.0) as u32) << 10) | ((f.seed & 255) << 18) | (((f.hot * 42.0).min(63.0) as u32) << 26);
        }
    }

    // rings
    for r in &mut fx.rings {
        let Ok((mut t, mut vis, tag, _)) = pooled.get_mut(r.e) else { continue };
        if r.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        r.life -= dt;
        if r.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        vis.set_if_neq(Visibility::Inherited);
        let k = r.life / r.max;
        let q = 1.0 - k;
        // fast, then slowing
        *t = Transform { translation: r.pos, rotation: r.rot, scale: Vec3::splat(r.size * 2.0 * (1.0 - (1.0 - q).powi(3)) + 1.0) };
        let kk = k * (0.6 + 0.4 * k);
        if let Some(mut tag) = tag {
            tag.value = (kk * 255.0) as u32 | (((r.width * 255.0) as u32) << 8) | ((r.seed & 255) << 16) | ((r.bill as u32) << 24);
        }
    }

    // shield ripples follow their ship
    for s in &mut fx.shields {
        let Ok((mut t, mut vis, tag, _)) = pooled.get_mut(s.e) else { continue };
        if s.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        s.life -= dt;
        let Ok(ship) = ships.get(s.ship) else {
            s.life = 0.0;
            vis.set_if_neq(Visibility::Hidden);
            continue;
        };
        if s.life <= 0.0 {
            s.life = 0.0;
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        vis.set_if_neq(Visibility::Inherited);
        *t = Transform { translation: ship.translation, rotation: s.rot, scale: Vec3::splat(s.scale) };
        let age = SHIELD_LIFE - s.life;
        let k = s.life / SHIELD_LIFE;
        let fin = (age * 25.0).min(1.0);
        s.k = (s.k0 + (1.0 - s.k0) * fin) * k * (0.4 + 0.6 * k);
        if let Some(mut tag) = tag {
            tag.value = s.bits | (age.min(1.0) * 1023.0) as u32 | (((s.k / 1.5).min(1.0) * 255.0) as u32) << 10;
        }
    }

    // hull fragments: tumble, cool, shed embers
    let mut trail: [(Vec3, f32); N_DEBRIS] = [(Vec3::ZERO, 0.0); N_DEBRIS];
    let mut n_trail = 0;
    for d in &mut fx.debris {
        let Ok((mut t, mut vis, _, _)) = pooled.get_mut(d.e) else { continue };
        if d.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        d.life -= dt;
        if d.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        vis.set_if_neq(Visibility::Inherited);
        d.pos += d.vel * dt;
        d.vel *= (1.0 - 0.25 * dt).max(0.0);
        d.rot = Quat::from_scaled_axis(d.spin * dt) * d.rot;
        *t = Transform { translation: d.pos, rotation: d.rot, scale: Vec3::splat(d.scale) };
        let heat = (d.life / d.max * 1.4 - 0.4).max(0.0);
        if heat > 0.25 {
            trail[n_trail] = (d.pos, heat);
            n_trail += 1;
        }
    }
    for &(p, _) in &trail[..n_trail] {
        if fx.rng.f() < dt * 30.0 {
            fx.particle(p, Vec3::ZERO, C_EMBER, 1.6, 0.35, 0.0);
        }
    }

    // explosion lights
    for l in &mut fx.lights {
        let Ok((mut t, mut vis, _, Some(mut pl))) = pooled.get_mut(l.e) else { continue };
        if l.life <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        l.life -= dt;
        let k = (l.life / l.max).max(0.0);
        if k <= 0.0 {
            vis.set_if_neq(Visibility::Hidden);
            continue;
        }
        vis.set_if_neq(Visibility::Inherited);
        t.translation = l.pos;
        pl.intensity = l.peak * k * k;
        let c = if l.cool { l.c0.lerp(C_COOL, 1.0 - k) } else { l.c0 };
        pl.color = Color::linear_rgb(c.x, c.y, c.z);
        pl.range = 500.0 + l.peak.sqrt() * 0.04;
    }
}

/// Damaged ships: fighters trail smoke (and flames when badly hit), capitals burn on their hull.
fn fx_damage(
    time: Res<Time>,
    paused: Res<Paused>,
    settings: Res<Settings>,
    mut fx: ResMut<Fx>,
    cam: Query<&GlobalTransform, With<MainCamera>>,
    ships: Query<(&Transform, &Ship, &Hittable, &InheritedVisibility, Has<Player>), Without<Dying>>,
) {
    let dt = if paused.0 { 0.0 } else { time.delta_secs().min(0.05) * fx.time_scale };
    let Ok(cam) = cam.single() else { return };
    if dt <= 0.0 || !fx.ready {
        return;
    }
    let ear = cam.translation();
    for (tf, ship, hit, vis, is_player) in &ships {
        if !vis.get() || (is_player && settings.view == View::Cockpit) || tf.translation.distance_squared(ear) > 1600.0 * 1600.0 {
            continue;
        }
        let hp = ship.hp / ship.max_hp.max(1.0);
        if ship.capital() {
            if hp < 0.6 && fx.rng.f() < dt * if hp < 0.3 { 9.0 } else { 4.0 } {
                let b = hit.half_extents.unwrap_or(Vec3::splat(hit.radius * 0.5));
                let local = Vec3::new(fx.rng.range(-b.x, b.x), fx.rng.range(-b.y, b.y) * 0.6 + b.y * 0.4, fx.rng.range(-b.z, b.z));
                let p = tf.translation + tf.rotation * local;
                let v = Vec3::new(fx.rng.range(-4.0, 4.0), fx.rng.range(2.0, 8.0), fx.rng.range(-4.0, 4.0));
                let (sz, lf) = (fx.rng.range(6.0, 14.0), fx.rng.range(0.5, 1.0));
                fx.particle(p, v, Vec3::new(2.6, 1.1, 0.3), sz, lf, 0.8);
                let (sz, lf) = (fx.rng.range(6.0, 10.0), fx.rng.range(2.0, 3.5));
                fx.smoke(p, sz, lf, Vec3::ZERO, 0.12, 0.5, 0.0);
            }
            continue;
        }
        let k = 1.0 - hp;
        if k < 0.3 {
            continue;
        }
        // from a damaged spot slightly behind the cockpit, drifting back with the ship's wake
        let r = ship.radius();
        let p = tf.translation + tf.rotation * Vec3::new(r * 0.25 * (r * 7.0).sin(), r * 0.12, -r * 0.35);
        let wake = tf.rotation * Vec3::Z * (-ship.speed * 0.15);
        let n = ((k - 0.3) * 70.0 * dt + fx.rng.f()) as usize;
        let heavy = k > 0.65;
        for _ in 0..n {
            let (sz, lf, shade) = if heavy { (fx.rng.range(5.0, 8.0), fx.rng.range(2.2, 3.4), fx.rng.range(0.2, 0.28)) } else { (fx.rng.range(3.0, 5.0), fx.rng.range(1.4, 2.2), fx.rng.range(0.42, 0.55)) };
            fx.smoke(p, sz, lf, wake, shade, if heavy { 0.85 } else { 0.6 }, 0.0);
            if heavy && fx.rng.f() < 0.5 {
                let v = wake + Vec3::new(fx.rng.range(-5.0, 5.0), fx.rng.range(-5.0, 5.0), fx.rng.range(-5.0, 5.0));
                let (sz, lf) = (fx.rng.range(3.0, 5.0), fx.rng.range(0.25, 0.45));
                fx.particle(p, v, Vec3::new(2.8, 1.1, 0.3), sz, lf, 1.5);
            }
            if heavy && fx.rng.f() < 0.15 {
                fx.sparks(p, C_SPARK, 2, 50.0);
            }
        }
    }
}

/// Give every engine nozzle a plume (ships, menu models, cutscene models).
fn attach_plumes(
    mut commands: Commands,
    assets: Option<Res<PlumeAssets>>,
    data: Res<GameData>,
    nozzles: Query<(Entity, &EngineNozzle, &ChildOf), Added<EngineNozzle>>,
    parents: Query<&ChildOf>,
    roots: Query<(Option<&Ship>, Option<&Name>)>,
) {
    let Some(assets) = assets else { return };
    for (e, nozzle, body) in &nozzles {
        // nozzle -> ShipBody -> ship root
        let owner = parents.get(body.parent()).map(|c| c.parent()).unwrap_or(body.parent());
        let (team, ace) = match roots.get(owner) {
            Ok((Some(ship), _)) => (ship.team, ship.def.ace),
            Ok((None, Some(name))) => {
                let kind = name.as_str().strip_prefix("Modell ").unwrap_or("");
                let def = data.ship(kind);
                (Team::from_def(def.team), def.ace)
            }
            _ => (Team::Union, false),
        };
        let color = if ace {
            2
        } else if team == Team::Aszendenz {
            1
        } else {
            0
        };
        let base = nozzle.radius * 4.0;
        // the nozzle gets a Visibility so the plume inherits the hidden body (own ship in the cockpit view)
        commands.entity(e).insert(Visibility::Inherited).with_child((
            Plume { owner, base, radius: nozzle.radius, color, ribbon: None },
            Mesh3d(assets.mesh.clone()),
            MeshMaterial3d(assets.mats[color].clone()),
            MeshTag::new((e.to_bits() as u32).wrapping_mul(37) & 255),
            Transform::from_scale(Vec3::new(base * 0.8, base * 0.8, base * 1.2)),
            Visibility::Inherited,
            NotShadowCaster,
            NoAutoAabb,
            Aabb::from_min_max(Vec3::new(-0.5, -0.5, -1.05), Vec3::new(0.5, 0.5, 0.1)),
        ));
    }
}

/// Drive output k (0.55 idle .. ~1.15 cruise .. ~2.2 boost, more on impulse) for a ship.
fn drive_output(ship: &Ship, player: Option<&Player>) -> (f32, bool) {
    let cruise = ship.def.speed.max(1.0);
    let ratio = ship.speed / cruise;
    let mut k = 0.55 + ratio.min(1.2) * 0.6;
    let boost = match player {
        Some(p) => p.boosting || p.impulse,
        None => ratio > 1.15,
    };
    if let Some(p) = player {
        if p.impulse {
            k *= 2.0 + 0.4 * p.impulse_prog;
        } else if p.boosting {
            k *= 1.7;
        }
    } else if boost {
        k *= 1.0 + 0.7 * ((ratio - 1.0) / 0.5).clamp(0.0, 1.0);
    }
    (k, boost)
}

/// Plume length and width follow the owner's drive output (web thrust()).
fn drive_plumes(mut fx: ResMut<Fx>, owners: Query<(&Ship, Option<&Player>, Has<Dying>)>, mut plumes: Query<(&Plume, &mut Transform, &mut Visibility)>) {
    let rng = &mut fx.rng;
    for (plume, mut t, mut vis) in &mut plumes {
        let (k, alive) = match owners.get(plume.owner) {
            Ok((ship, player, dying)) => (drive_output(ship, player).0, !dying),
            Err(_) => (0.55, true),
        };
        vis.set_if_neq(if alive { Visibility::Inherited } else { Visibility::Hidden });
        let k = k * rng.range(0.96, 1.04);
        let b = plume.base;
        let w = b * (0.7 + 0.3 * k.min(2.2));
        t.scale = Vec3::new(w, w, b * 1.2 * k.max(0.2).powf(1.5));
    }
}

/// Feed the exhaust ribbons and upload the particle buffers (after transforms are final).
#[allow(clippy::too_many_arguments)]
fn fx_upload(
    time: Res<Time>,
    paused: Res<Paused>,
    state: Res<State<AppState>>,
    mut fx: ResMut<Fx>,
    mut buffers: ResMut<Assets<ShaderBuffer>>,
    cam: Query<&GlobalTransform, With<MainCamera>>,
    mut plumes: Query<(Entity, &mut Plume, &GlobalTransform, &InheritedVisibility)>,
    owners: Query<(&Ship, Option<&Player>, Has<Dying>)>,
    mut systems: Query<(&mut Transform, &mut Visibility), With<FxSystem>>,
) {
    if !fx.ready {
        return;
    }
    let dt = if paused.0 { 0.0 } else { time.delta_secs().min(0.05) * fx.time_scale };
    let cam = cam.single().map(|c| (c.translation(), c.forward().as_vec3())).unwrap_or((Vec3::ZERO, Vec3::NEG_Z));
    fx.frame = fx.frame.wrapping_add(1);

    // ribbons behind fighters near the camera
    if *state.get() == AppState::Flight {
        for (e, mut plume, gt, vis) in &mut plumes {
            let Ok((ship, player, dying)) = owners.get(plume.owner) else { continue };
            let p = gt.translation();
            if ship.capital() || dying || !vis.get() || p.distance_squared(cam.0) > RIB_RANGE * RIB_RANGE {
                continue;
            }
            let (_, boost) = drive_output(ship, player);
            let width = plume.radius * if boost { 0.9 } else { 0.55 };
            let col = DRIVE[plume.color];
            let mut rib = plume.ribbon;
            fx.feed_ribbon(&mut rib, e, p, width, col, dt, player.is_some());
            plume.ribbon = rib;
        }
    }

    if !fx.live {
        return;
    }
    let fx = &mut *fx;
    let now = fx.time;
    let mut any = false;

    // ---- glow: fire points, flashes, lens streaks, debris heat ----
    if let Some(sys) = fx.glow.as_mut() {
        for (i, p) in fx.fire.iter().enumerate() {
            if p.life <= 0.0 {
                sys.kill(i);
                continue;
            }
            any = true;
            let k = p.life / p.max;
            let size = (p.size0 * (0.4 + 0.6 * k) + p.grow * (1.0 - k)) * POINT;
            // white-hot -> orange -> deep red
            let c = [p.base.x, p.base.y * (0.25 + 0.75 * k * k), p.base.z * k * k * k, k * p.alpha];
            sys.put(i, p.pos, size, c, [1.0, 0.0, 0.0, 0.0]);
        }
        for (j, f) in fx.flashes.iter().enumerate() {
            let i = N_FIRE + j;
            if f.life <= 0.0 {
                sys.kill(i);
                continue;
            }
            any = true;
            let k = f.life / f.max;
            sys.put(i, f.pos, f.size * (1.6 - k * 0.8) * 0.5, [f.color.x, f.color.y, f.color.z, k], [1.0, 1.0, 0.0, 0.0]);
        }
        for (j, f) in fx.lenses.iter().enumerate() {
            let i = N_FIRE + N_FLASH + j;
            if f.life <= 0.0 {
                sys.kill(i);
                continue;
            }
            any = true;
            let k = f.life / f.max;
            sys.put(i, f.pos, f.size * (1.3 - k * 0.3) * 0.5, [f.color.x, f.color.y, f.color.z, k * k], [0.07 * k / (1.3 - k * 0.3), 2.0, 0.0, 0.0]);
        }
        for (j, d) in fx.debris.iter().enumerate() {
            let i = N_FIRE + N_FLASH + N_LENS + j;
            let heat = if d.life > 0.0 { (d.life / d.max * 1.4 - 0.4).max(0.0) } else { 0.0 };
            if heat <= 0.0 {
                sys.kill(i);
                continue;
            }
            any = true;
            sys.put(i, d.pos, d.scale * 0.9, [C_EMBER.x, C_EMBER.y, C_EMBER.z, heat.min(1.0) * 0.6], [1.0, 0.0, 0.0, 0.0]);
        }
    }

    // ---- smoke, back to front ----
    if let Some(sys) = fx.smoke_gpu.as_mut() {
        fx.smoke_order.clear();
        for (i, p) in fx.smoke.iter().enumerate() {
            if p.life > 0.0 {
                fx.smoke_order.push((p.pos.distance_squared(cam.0), i as u16));
            }
        }
        fx.smoke_order.sort_unstable_by(|a, b| b.0.total_cmp(&a.0));
        let n = fx.smoke_order.len();
        for (slot, &(_, i)) in fx.smoke_order.iter().enumerate() {
            let p = &fx.smoke[i as usize];
            let k = p.life / p.max;
            let size = (p.size0 + p.grow * (1.0 - k)) * POINT;
            // embers inside fresh explosion smoke glow orange, cooling over the first half of its life
            let h = p.heat * (k * 2.0 - 1.0);
            let h = if h > 0.0 { h * h } else { 0.0 };
            let a = p.alpha * ((1.0 - k) * 6.0).min(1.0) * k;
            let c = [p.base.x + 2.4 * h, p.base.y + 0.75 * h, p.base.z + 0.15 * h, a];
            sys.put(slot, p.pos, size, c, [p.seed * 6.283, p.seed, 0.0, 0.0]);
        }
        for slot in n..N_SMOKE {
            sys.kill(slot);
        }
        any |= n > 0;
    }

    // ---- sparks / embers ----
    if let Some(sys) = fx.streak_gpu.as_mut() {
        for (i, s) in fx.streaks.iter().enumerate() {
            if s.life <= 0.0 {
                sys.kill(i);
                continue;
            }
            any = true;
            let k = s.life / s.max;
            let c = if s.cool { [s.base.x, s.base.y * (0.2 + 0.8 * k * k), s.base.z * k * k * k] } else { [s.base.x, s.base.y, s.base.z] };
            let tail = s.pos - s.vel * s.len;
            sys.put(i, s.pos, s.w0 * (0.5 + 0.5 * k), [c[0], c[1], c[2], (k * 2.5).min(1.0)], [tail.x, tail.y, tail.z, 0.0]);
        }
    }

    // ---- ribbons ----
    if let Some(sys) = fx.ribbon_gpu.as_mut() {
        let frame = fx.frame;
        for (r, rib) in fx.ribbons.iter_mut().enumerate() {
            let base = r * RIB_N;
            if rib.owner.is_some() && rib.fed != frame && now - rib.pts[0].t0 > RIB_LIFE {
                // not fed and faded out: back to the pool
                *rib = Ribbon::default();
            }
            if rib.owner.is_none() {
                for i in 0..RIB_N {
                    sys.kill(base + i);
                }
                continue;
            }
            any = true;
            for (i, pt) in rib.pts.iter().enumerate() {
                let age = now - pt.t0;
                let k = age / RIB_LIFE;
                if !(0.0..1.0).contains(&k) {
                    // dead point: collapses onto its neighbour with no width and no alpha
                    let o = (base + i) * 3;
                    sys.staging[o] = [pt.pos.x, pt.pos.y, pt.pos.z, 0.0];
                    sys.staging[o + 1] = [0.0; 4];
                    continue;
                }
                let a = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, age);
                sys.put(base + i, pt.pos, pt.width, [pt.col.x, pt.col.y, pt.col.z, a], [pt.dir.x, pt.dir.y, pt.dir.z, k]);
            }
        }
    }

    // upload what changed; draw order: smoke first, additive glows on top
    let smoke_back = fx.smoke_order.first().map_or(0.0, |s| s.0.sqrt());
    let systems_list = [(fx.glow.as_mut(), 0.0), (fx.smoke_gpu.as_mut(), smoke_back), (fx.streak_gpu.as_mut(), 0.0), (fx.ribbon_gpu.as_mut(), 0.0)];
    for (sys, back) in systems_list {
        let Some(sys) = sys else { continue };
        let alive = sys.staging.chunks_exact(3).any(|c| c[0][3] > 0.0);
        if let Ok((mut t, mut vis)) = systems.get_mut(sys.entity) {
            vis.set_if_neq(if alive { Visibility::Inherited } else { Visibility::Hidden });
            t.translation = cam.0 + cam.1 * back;
        }
        if alive || sys.dirty {
            if let Some(mut buf) = buffers.get_mut(&sys.buffer) {
                buf.clear();
                buf.extend_from_slice(&sys.staging);
            }
        }
        sys.dirty = alive;
    }
    fx.live = any;
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Leaving a mission: every effect stops and the pools are hidden.
fn fx_clear(mut fx: ResMut<Fx>, mut pooled: Query<&mut Visibility, With<FxPooled>>) {
    fx.clear();
    for mut v in &mut pooled {
        *v = Visibility::Hidden;
    }
}

// ---------- test hook ----------

#[derive(Resource)]
struct FxTest {
    big: bool,
    hits: bool,
    booms: bool,
    ships: bool,
    spawned: bool,
    /// capital death sequence: position, time, next pop
    capital: Option<(Vec3, f32, f32)>,
    period: f32,
    size: Option<f32>,
    dist: f32,
    t: f32,
    n: u32,
    next: f32,
    count: u32,
}

impl FxTest {
    fn from_env() -> Option<Self> {
        let v = std::env::var("SF_FX").ok()?;
        if v.is_empty() || v == "0" {
            return None;
        }
        let num = |k: &str| std::env::var(k).ok().and_then(|s| s.parse::<f32>().ok());
        Some(Self {
            big: v == "big",
            hits: v == "1" || v == "hits",
            booms: v != "hits" && v != "ships",
            ships: v == "ships",
            spawned: false,
            capital: None,
            period: num("SF_FX_PERIOD").unwrap_or(3.0),
            size: num("SF_FX_SIZE"),
            dist: num("SF_FX_DIST").unwrap_or(140.0),
            t: 0.0,
            n: 0,
            next: num("SF_FX_AT").unwrap_or(1.0),
            count: 0,
        })
    }
}

/// SF_FX=1|boom|hits|big|ships: explosions (SF_FX_AT first, every SF_FX_PERIOD s, SF_FX_SIZE, SF_FX_DIST m
/// ahead), shield / hull hits on the nearest ship, a capital's death sequence (big), fighters crossing the
/// view (ships). SF_FX_SLOW=<factor> runs the effects in slow motion.
#[allow(clippy::too_many_arguments)]
fn fx_test(
    mut commands: Commands,
    time: Res<Time>,
    mut test: ResMut<FxTest>,
    lib: Res<crate::ships::ShipLibrary>,
    data: Res<GameData>,
    players: Query<(&Transform, &Ship), With<Player>>,
    others: Query<(Entity, &Transform, &Ship), Without<Player>>,
    fx: Res<Fx>,
    mut explode: MessageWriter<ExplodeMsg>,
    mut hits: MessageWriter<HitFxMsg>,
) {
    let Ok((pt, me)) = players.single() else { return };
    let dt = time.delta_secs();
    test.t += dt;
    if (test.t * 2.0) as u32 != ((test.t - dt) * 2.0) as u32 {
        info!("fx test: t {:.2}, effect time {:.2}", test.t, fx.time);
        for (_, tf, ship) in &others {
            let d = tf.translation - pt.translation;
            info!("fx test:   {} ahead {:.0} side {:.0} speed {:.0}", ship.kind, d.dot(pt.rotation * Vec3::Z), d.dot(pt.rotation * Vec3::X), ship.speed);
        }
    }
    let fwd = pt.rotation * Vec3::Z;
    let right = pt.rotation * Vec3::X;
    let up = pt.rotation * Vec3::Y;
    if test.ships && !test.spawned {
        test.spawned = true;
        // fighters flying ahead of the player and slowly across the view, the last one on boost
        for (i, kind) in ["falke", "klinge", "archon"].into_iter().enumerate() {
            let side = [1.0, -1.0, 0.4][i];
            let at = if i == 0 { pt.translation + fwd * 4.0 + right * 16.0 + up * 2.0 } else { pt.translation + fwd * (10.0 + 30.0 * i as f32) + right * side * 30.0 + up * (8.0 * i as f32 - 6.0) };
            let e = crate::ships::spawn_ship(&mut commands, &lib, &data, kind, Transform::from_translation(at).with_rotation(crate::flight::rotation_facing(if i == 0 { fwd } else { fwd - right * side * 0.1 }, up)));
            let def = data.ship(kind);
            let mut ship = Ship::new(kind, def);
            // the first one flies in formation on the right, close to the camera
            ship.speed = if i == 0 { me.speed } else { def.speed * if i == 2 { 1.6 } else { 1.0 } };
            // damaged: none, light smoke, heavy smoke and flames
            ship.hp = ship.max_hp * [1.0, 0.55, 0.2][i];
            commands.entity(e).insert(ship);
        }
    }
    if let Some((at, t, pop)) = test.capital.as_mut() {
        // a capital ship's death as weapons.rs sends it: pops every 0.13 s, then the final blast
        *t += dt;
        *pop -= dt;
        if *pop <= 0.0 && *t < 2.6 {
            *pop = 0.13;
            let k = (*t * 37.0).sin();
            let off = Vec3::new(k * 60.0, (k * 3.1).cos() * 20.0, (k * 7.3).sin() * 110.0);
            explode.write(ExplodeMsg { pos: *at + off, size: 1.5 + (k * 0.5 + 0.5) * 2.0 });
        }
        if *t >= 2.6 {
            explode.write(ExplodeMsg { pos: *at, size: 6.0 });
            test.capital = None;
        }
    }
    if test.hits {
        let near = others.iter().min_by(|a, b| a.1.translation.distance_squared(pt.translation).total_cmp(&b.1.translation.distance_squared(pt.translation)));
        if let Some((e, tf, ship)) = near {
            let k = (test.t * 7.0) as u32;
            if k != test.n {
                test.n = k;
                let d = (pt.translation - tf.translation).normalize_or(Vec3::Z);
                let off = Vec3::new((k as f32 * 1.7).sin(), (k as f32 * 2.3).cos(), 0.3).normalize() * 0.6;
                let p = tf.translation + (d + off).normalize() * ship.radius();
                let shield = k % 3 != 0;
                let c = if shield { Vec3::new(0.6, 1.6, 3.0) } else { C_SPARK };
                hits.write(HitFxMsg { pos: p, ship: e, shield, color: LinearRgba::rgb(c.x, c.y, c.z) });
            }
        }
    }
    if test.booms && test.t >= test.next {
        test.next += test.period;
        let n = test.count;
        test.count += 1;
        if test.big {
            let at = pt.translation + fwd * test.dist.max(600.0) + up * 40.0;
            info!("fx test: capital death sequence at t {:.2}", test.t);
            explode.write(ExplodeMsg { pos: at, size: 3.0 });
            test.capital = Some((at, 0.0, 0.13));
        } else {
            let side = if n % 2 == 0 { -1.0 } else { 1.0 };
            let at = pt.translation + fwd * test.dist + right * side * test.dist * 0.15 + up * 8.0;
            let size = test.size.unwrap_or(if n % 3 == 2 { 1.6 } else { 1.0 });
            info!("fx test: explosion {n} size {size} at t {:.2}", test.t);
            explode.write(ExplodeMsg { pos: at, size });
        }
    }
}
