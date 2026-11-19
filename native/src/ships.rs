//! Ship models (owner: ships agent): procedural meshes and PBR materials for every ship type of
//! ships.json, ported from src/ships.js. All models are built once at Startup into the `ShipLibrary`
//! (one merged mesh per material and type); `spawn_ship()` only spawns entities.
//!
//! Model hierarchy of a spawned ship:
//! ```text
//! Ship root (Ship, Hittable, InMission, Transform)
//! └─ ShipBody (banking rotates only this)
//!    ├─ mesh parts (Mesh3d + MeshMaterial3d)
//!    ├─ EngineNozzle at every nozzle exit (radius = nozzle radius)
//!    ├─ Muzzle { idx } at every def.guns position (wing guns snapped to their pods, as on the web)
//!    ├─ Turret { idx } at every def.turrets position (capitals; +Y = outward normal) with a turret head
//!    └─ Blinker nav lights (billboard halos)
//! ```
//!
//! Test hook: `SF_SHOWCASE=fighters|capitals|all|<kind>[,<kind>...]` lays the models out in front of the
//! camera when Flight starts, under a studio light rig (`SF_SHOWCASE_YAW`, `SF_SHOWCASE_PITCH` degrees,
//! `SF_SHOWCASE_SPIN` deg/s, `SF_SHOWCASE_DIST` metres override the framing; `SF_SHOWCASE_LIGHTS=1` keeps
//! the nav lights on). Mixed capital line-ups are scaled to fit their grid cells.

mod designs;
mod mesh;
mod tex;

use crate::common::*;
use bevy::camera::visibility::VisibilitySystems;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use designs::{Cp, Pal, M};
use std::collections::HashMap;
use std::sync::Arc;

#[allow(unused_imports)]
pub use designs::{Bay, BAY as AURORA_BAY};

pub struct ShipsPlugin;

impl Plugin for ShipsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ShipLibrary>()
            .add_systems(Startup, build_library)
            .add_systems(PostUpdate, blink_lights.after(TransformSystems::Propagate).before(VisibilitySystems::VisibilityPropagate));
        if let Some(cfg) = Showcase::from_env() {
            app.insert_resource(cfg)
                .add_systems(OnEnter(AppState::Flight), showcase_spawn)
                .add_systems(Update, showcase_hide_player.run_if(in_state(AppState::Flight)))
                .add_systems(PostUpdate, showcase_follow.before(TransformSystems::Propagate).run_if(in_state(AppState::Flight)));
        }
    }
}

// ---------- public components ----------

/// Gun muzzle on a ship model (child of the body); `idx` indexes `ShipDef::guns`. Fires along the ship's +Z.
#[allow(dead_code)] // read by other modules (weapons, cutscenes)
#[derive(Component, Clone, Copy, Debug)]
pub struct Muzzle {
    pub idx: usize,
}

/// Capital-ship turret mount (child of the body); `idx` indexes `ShipDef::turrets`. Local +Y is the hull's
/// outward normal, local +Z the ship's forward direction projected onto the hull. Its child is the turret
/// head (barrels along local +Z): rotate the Turret's Transform about local Y to aim it.
#[allow(dead_code)] // read by other modules (weapons, cutscenes)
#[derive(Component, Clone, Copy, Debug)]
pub struct Turret {
    pub idx: usize,
}

/// Capital ships only: the hull for hit tests and collisions (see `HullShape`), shared by every ship of the
/// type. Finer than `Hittable::half_extents` for saucers, nacelles, rings and prows; weapons and collisions
/// test against it after the bounding-sphere check with radius `max(Hittable::radius, extent)`.
#[derive(Component, Clone, Debug)]
pub struct HullBoxes(pub Arc<HullShape>);

/// The head of a capital-ship turret (child of its `Turret` mount). weapons.rs turns it towards the target:
/// `base` is the mount's rotation in body space, `ship` the ship's root entity.
#[derive(Component, Clone, Copy, Debug)]
pub struct TurretHead {
    pub idx: usize,
    pub ship: Entity,
    pub base: Quat,
}

/// Blinking nav light (billboard halo). Visible for 14 % of every 1/rate seconds, offset by `phase`.
#[derive(Component, Clone, Copy, Debug)]
pub struct Blinker {
    pub rate: f32,
    pub phase: f32,
}

// ---------- library ----------

/// One mesh of a model (models are merged per material, so parts carry identity transforms).
#[derive(Clone)]
pub struct ShipPart {
    pub mesh: Handle<Mesh>,
    pub material: Handle<StandardMaterial>,
    pub transform: Transform,
    pub shadow: bool,
}

#[derive(Clone)]
pub struct NavLight {
    pub pos: Vec3,
    pub rate: f32,
    pub phase: f32,
    pub size: f32,
    pub material: Handle<StandardMaterial>,
}

/// A built ship type.
#[derive(Clone, Default)]
pub struct ShipModel {
    pub parts: Vec<ShipPart>,
    /// engine nozzle exits in body space (position, radius); the exhaust points along -Z
    pub nozzles: Vec<(Vec3, f32)>,
    /// gun muzzles in body space, one per `ShipDef::guns` entry
    pub guns: Vec<Vec3>,
    /// turret mounts in body space (position, outward normal), one per `ShipDef::turrets` entry
    pub turrets: Vec<(Vec3, Vec3)>,
    pub lights: Vec<NavLight>,
    /// turret head mesh and material (capitals)
    pub turret_head: Option<(Handle<Mesh>, Handle<StandardMaterial>)>,
    /// model bounds in body space
    pub aabb_min: Vec3,
    pub aabb_max: Vec3,
    /// farthest model point from the origin (for framing / culling)
    pub extent: f32,
    pub triangles: usize,
    /// capitals: hull approximation for hit tests (see `HullBoxes`)
    pub hull: Option<Arc<HullShape>>,
}

/// Materials of the TUS Aurora's hangar signal lamps, energy field and clamps: shared handles a launch
/// sequence may recolour (dim red/amber/green by default; field cyan, clamps amber).
#[allow(dead_code)] // read by other modules (weapons, cutscenes)
#[derive(Clone, Default)]
pub struct BayLights {
    pub red: Handle<StandardMaterial>,
    pub amber: Handle<StandardMaterial>,
    pub green: Handle<StandardMaterial>,
    pub field: Handle<StandardMaterial>,
    pub clamp: Handle<StandardMaterial>,
}

/// Meshes and materials for every ship type, built once at Startup.
#[derive(Resource, Default)]
pub struct ShipLibrary {
    pub models: HashMap<String, ShipModel>,
    pub halo_mesh: Handle<Mesh>,
    pub bay: BayLights,
}

impl ShipLibrary {
    /// Model of `kind`, falling back to the Dorn like `GameData::ship` does.
    pub fn model(&self, kind: &str) -> Option<&ShipModel> {
        self.models.get(kind).or_else(|| self.models.get("dorn"))
    }
}

/// Ship types in a sensible preview order (fighters first, Union before Aszendenz, then capitals).
pub fn ship_preview_kinds() -> &'static [&'static str] {
    &[
        "sperber", "falke", "greif", "dorn", "klinge", "holt", "hammer", "schwinge", "archon", "kurier", "transport", "tanker", "aurora", "valkyrie", "habitat", "prison", "relay", "zerstoerer", "dreadnought", "station", "gate",
    ]
}

// ---------- textures & materials ----------

struct Tex {
    plate: [Handle<Image>; 3],
    chitin: [Handle<Image>; 3],
    veins: Handle<Image>,
    panel: [Handle<Image>; 3],
    cchitin: [Handle<Image>; 3],
    windows: Handle<Image>,
    asz_lights: Handle<Image>,
    decals: Vec<Handle<Image>>,
    registries: Vec<Handle<Image>>,
    glow: Handle<Image>,
    ripples: Handle<Image>,
}

fn build_textures(images: &mut Assets<Image>) -> Tex {
    use tex::*;
    // the heavy maps in parallel (pure CPU work)
    let (plate, chitin_f, panel, chitin_c, small) = std::thread::scope(|s| {
        let plate = s.spawn(|| {
            let mut m = metal_hull(1024, 5, 70.0, rgba(214, 96, 30, 0.85));
            weather(&mut m, 501, 1.3);
            m
        });
        let chitin_f = s.spawn(|| chitin(1024, 17, 12, 0.3));
        let panel = s.spawn(|| {
            let mut m = metal_hull(1024, 11, 44.0, rgba(214, 96, 30, 0.8));
            weather(&mut m, 1101, 1.4);
            m
        });
        let chitin_c = s.spawn(|| chitin(1024, 23, 14, 0.32));
        let small = s.spawn(|| {
            let decals: Vec<Canvas> = designs::DECALS.iter().enumerate().map(|(i, c)| if *c == "*" { glyph_decal() } else { code_decal(c, 900 + i as u32) }).collect();
            let regs: Vec<Canvas> = designs::REGISTRIES.iter().map(|(n, s)| registry(n, s)).collect();
            (decals, regs, windows(512, 77, false), windows(512, 78, true), glow(64), ripples(512))
        });
        (plate.join().unwrap(), chitin_f.join().unwrap(), panel.join().unwrap(), chitin_c.join().unwrap(), small.join().unwrap())
    });
    let (decals, regs, win, pores, glow_c, ripple_c) = small;
    let hull_set = |images: &mut Assets<Image>, m: HullMaps, strength: f32| -> [Handle<Image>; 3] {
        let n = images.add(normal_image(&m.height, strength));
        [images.add(color_image(m.color, true)), n, images.add(metal_rough_image(m.rough))]
    };
    let (cf, veins_f) = chitin_f;
    let (cc, veins_c) = chitin_c;
    // Aszendenz capital lights: glowing pores in rows plus the brighter veins
    let mut lights = pores;
    for (p, v) in lights.px.iter_mut().zip(&veins_c.px) {
        p[0] = (p[0] * 0.8).max(v[0]);
    }
    Tex {
        plate: hull_set(images, plate, 0.9),
        chitin: hull_set(images, cf, 1.2),
        veins: images.add(emissive_image(veins_f)),
        panel: hull_set(images, panel, 0.9),
        cchitin: hull_set(images, cc, 1.4),
        windows: images.add(emissive_image(win)),
        asz_lights: images.add(emissive_image(lights)),
        decals: decals.into_iter().map(|c| images.add(color_image(c, false))).collect(),
        registries: regs.into_iter().map(|c| images.add(color_image(c, false))).collect(),
        glow: images.add(color_image(glow_c, false)),
        ripples: images.add(color_image(ripple_c, false)),
    }
}

fn srgb(c: u32) -> Color {
    Color::srgb_u8((c >> 16) as u8, (c >> 8) as u8, c as u8)
}
fn lin(r: f32, g: f32, b: f32) -> LinearRgba {
    LinearRgba::rgb(r, g, b)
}

fn pal_glow(p: Pal) -> LinearRgba {
    match p {
        Pal::Union => lin(0.5, 1.6, 4.0),
        Pal::Asz => lin(4.0, 0.35, 1.3),
        Pal::Ace => lin(4.0, 1.6, 0.3),
    }
}
fn cp_glow(c: Cp) -> LinearRgba {
    if c == Cp::Asz { pal_glow(Pal::Asz) } else { pal_glow(Pal::Union) }
}

/// self-lit material (HDR colour; bloom makes it glow)
fn unlit(c: LinearRgba) -> StandardMaterial {
    StandardMaterial { base_color: Color::LinearRgba(c), unlit: true, ..default() }
}
fn additive(c: LinearRgba, tex: Option<Handle<Image>>) -> StandardMaterial {
    StandardMaterial { base_color: Color::LinearRgba(c), base_color_texture: tex, unlit: true, alpha_mode: AlphaMode::Add, cull_mode: None, double_sided: true, ..default() }
}
fn textured(color: Color, set: &[Handle<Image>; 3], metallic: f32, rough: f32) -> StandardMaterial {
    StandardMaterial {
        base_color: color,
        base_color_texture: Some(set[0].clone()),
        normal_map_texture: Some(set[1].clone()),
        metallic_roughness_texture: Some(set[2].clone()),
        metallic,
        perceptual_roughness: rough,
        ..default()
    }
}

fn material(m: M, t: &Tex) -> StandardMaterial {
    match m {
        M::Hull(Pal::Union) => StandardMaterial { clearcoat: 0.55, clearcoat_perceptual_roughness: 0.3, ..textured(srgb(0x98a2ae), &t.plate, 0.85, 1.1) },
        M::Hull(Pal::Asz) => StandardMaterial {
            clearcoat: 0.4,
            clearcoat_perceptual_roughness: 0.2,
            emissive: pal_glow(Pal::Asz) * 0.35,
            emissive_texture: Some(t.veins.clone()),
            ..textured(srgb(0x6a5478), &t.chitin, 0.55, 0.9)
        },
        M::Hull(Pal::Ace) => StandardMaterial { clearcoat: 0.5, clearcoat_perceptual_roughness: 0.25, ..textured(srgb(0xa07a30), &t.plate, 1.0, 0.8) },
        M::Dark(Pal::Union) => textured(srgb(0x2c333d), &t.plate, 1.0, 1.45),
        M::Dark(Pal::Asz) => StandardMaterial { emissive: pal_glow(Pal::Asz) * 0.2, emissive_texture: Some(t.veins.clone()), ..textured(srgb(0x2a2030), &t.chitin, 0.7, 1.2) },
        M::Dark(Pal::Ace) => textured(srgb(0x2a2010), &t.plate, 1.0, 1.3),
        M::Accent(p) => {
            let c = match p {
                Pal::Union => 0xff6a12,
                Pal::Asz => 0x6a1038,
                Pal::Ace => 0xb07a12,
            };
            StandardMaterial { base_color: srgb(c), metallic: 0.5, perceptual_roughness: 0.4, ..default() }
        }
        M::Canopy(p) => {
            let (c, e) = if p == Pal::Union { (0x0a1626, lin(0.015, 0.035, 0.06)) } else { (0x30040f, lin(0.08, 0.0, 0.015)) };
            StandardMaterial { base_color: srgb(c), metallic: 1.0, perceptual_roughness: 0.06, reflectance: 0.9, emissive: e, ..default() }
        }
        M::Glow(p) => unlit(pal_glow(p)),
        M::Line(p) => unlit(pal_glow(p) * 0.6),
        M::Decal(i) => {
            let glyph = i == designs::DECAL_GLYPH;
            let img = t.decals[i as usize].clone();
            StandardMaterial {
                base_color_texture: Some(img.clone()),
                alpha_mode: AlphaMode::Blend,
                perceptual_roughness: 0.6,
                metallic: 0.2,
                emissive: if glyph { LinearRgba::WHITE * 0.8 } else { LinearRgba::BLACK },
                emissive_texture: glyph.then_some(img),
                depth_bias: 50.0,
                ..default()
            }
        }
        M::Soot => StandardMaterial { base_color: srgb(0x17130f), metallic: 0.3, perceptual_roughness: 0.95, ..default() },
        M::Sail => StandardMaterial { clearcoat: 0.5, clearcoat_perceptual_roughness: 0.2, emissive: pal_glow(Pal::Asz) * 0.25, emissive_texture: Some(t.veins.clone()), ..textured(srgb(0x8a78a6), &t.chitin, 0.25, 0.9) },
        M::CHull(cp) | M::CTank(cp) => {
            let lit = matches!(m, M::CHull(_));
            match cp {
                Cp::Union => StandardMaterial {
                    clearcoat: 0.45,
                    clearcoat_perceptual_roughness: 0.3,
                    emissive: if lit { lin(1.8, 1.5, 0.9) } else { LinearRgba::BLACK },
                    emissive_texture: lit.then(|| t.windows.clone()),
                    ..textured(srgb(0x8f98a4), &t.panel, 0.83, 1.1)
                },
                Cp::Wreck => StandardMaterial {
                    emissive: if lit { lin(0.35, 0.18, 0.08) } else { LinearRgba::BLACK },
                    emissive_texture: lit.then(|| t.windows.clone()),
                    ..textured(srgb(0x55585e), &t.panel, 0.5, 1.6)
                },
                Cp::Asz => StandardMaterial {
                    clearcoat: 0.35,
                    clearcoat_perceptual_roughness: 0.25,
                    emissive: if lit { lin(2.4, 0.3, 0.8) * 0.8 } else { pal_glow(Pal::Asz) * 0.3 },
                    emissive_texture: Some(if lit { t.asz_lights.clone() } else { t.veins.clone() }),
                    ..textured(srgb(0x6a5a80), &t.cchitin, 0.7, 0.95)
                },
            }
        }
        M::CDark(cp) => match cp {
            Cp::Asz => StandardMaterial { emissive: pal_glow(Pal::Asz) * 0.15, emissive_texture: Some(t.veins.clone()), ..textured(srgb(0x2a2234), &t.cchitin, 0.75, 1.2) },
            _ => textured(srgb(0x30363f), &t.panel, 1.0, 1.5),
        },
        M::CGlow(cp) => unlit(cp_glow(cp)),
        M::CAccent(cp) => StandardMaterial { base_color: srgb(if cp == Cp::Asz { 0x6a1038 } else { 0xff6a12 }), metallic: 0.4, perceptual_roughness: 0.5, ..default() },
        M::CStrip(cp) => unlit(match cp {
            Cp::Wreck => lin(0.25, 0.08, 0.04),
            Cp::Union => lin(0.6, 1.8, 3.0),
            Cp::Asz => lin(3.0, 0.3, 0.9),
        }),
        M::Throat(cp) => unlit(cp_glow(cp) * 0.45),
        M::Bridge => unlit(lin(1.2, 1.0, 0.6)),
        M::Ward => unlit(lin(0.3, 0.8, 1.3)),
        M::Windows => StandardMaterial { base_color: Color::WHITE, unlit: true, ..default() },
        M::Registry(i) => StandardMaterial {
            base_color_texture: Some(t.registries[i as usize].clone()),
            alpha_mode: AlphaMode::Blend,
            perceptual_roughness: 0.6,
            metallic: 0.2,
            depth_bias: 50.0,
            ..default()
        },
        M::BayGlow => unlit(lin(1.15, 1.05, 0.9)),
        M::BayBand => unlit(lin(0.15, 0.5, 0.85)),
        M::BayRed => unlit(lin(0.25, 0.02, 0.02)),
        M::BayAmber => unlit(lin(0.25, 0.15, 0.02)),
        M::BayGreen => unlit(lin(0.02, 0.25, 0.06)),
        M::BayField => additive(lin(0.25, 0.7, 1.4) * 0.32, None),
        M::Clamp => unlit(lin(2.4, 1.1, 0.2)),
        M::Coil => unlit(lin(0.3, 0.85, 1.7)),
        M::Intake => unlit(lin(2.2, 0.9, 0.35)),
        M::Cell => unlit(lin(1.6, 0.25, 0.7)),
        M::Burn => unlit(lin(3.0, 0.9, 0.2)),
        M::Ember => unlit(lin(1.6, 0.35, 0.08)),
        M::Hole => StandardMaterial { base_color: srgb(0x050403), unlit: true, double_sided: true, cull_mode: None, ..default() },
        M::GateField => additive(lin(0.4, 1.2, 2.4) * 0.24, Some(t.ripples.clone())),
        M::Halo(i) => {
            let c = designs::LIGHT_COLORS[i as usize];
            additive(lin(c[0], c[1], c[2]), Some(t.glow.clone()))
        }
    }
}

/// uv tile size (metres per texture repeat)
fn tile(m: M) -> f32 {
    match m {
        M::Hull(_) | M::Dark(_) | M::Sail => 8.0,
        M::CHull(_) | M::CTank(_) | M::CDark(_) => 60.0,
        _ => 1.0,
    }
}
fn normal_mapped(m: M) -> bool {
    matches!(m, M::Hull(_) | M::Dark(_) | M::Sail | M::CHull(_) | M::CTank(_) | M::CDark(_))
}
fn casts_shadow(m: M) -> bool {
    matches!(m, M::Hull(_) | M::Dark(_) | M::Accent(_) | M::Canopy(_) | M::Soot | M::Sail | M::CHull(_) | M::CTank(_) | M::CDark(_) | M::CAccent(_))
}

// ---------- building ----------

fn build_library(mut lib: ResMut<ShipLibrary>, data: Res<GameData>, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>, mut images: ResMut<Assets<Image>>) {
    let t0 = std::time::Instant::now();
    let tex = build_textures(&mut images);
    let t_tex = t0.elapsed();
    let mut cache: HashMap<M, Handle<StandardMaterial>> = HashMap::new();
    let mut mat_of = |m: M, mats: &mut Assets<StandardMaterial>| cache.entry(m).or_insert_with(|| mats.add(material(m, &tex))).clone();
    lib.halo_mesh = meshes.add(mesh::plane(1.0, 1.0).to_mesh(1.0, false));
    lib.bay = BayLights {
        red: mat_of(M::BayRed, &mut mats),
        amber: mat_of(M::BayAmber, &mut mats),
        green: mat_of(M::BayGreen, &mut mats),
        field: mat_of(M::BayField, &mut mats),
        clamp: mat_of(M::Clamp, &mut mats),
    };
    let head_mesh = meshes.add(designs::turret_head().to_mesh(1.0 / 8.0, false));
    let mut kinds: Vec<&String> = data.ships.keys().collect();
    kinds.sort();
    let mut total = 0;
    for kind in kinds {
        let def = &data.ships[kind];
        let Some(mut built) = designs::build(kind) else {
            warn!("ships: no model for ship type '{kind}'");
            continue;
        };
        if def.capital {
            let mounts = designs::turret_mounts(kind, &def.turrets);
            designs::add_turret_domes(&mut built, &mounts);
        }
        // wing guns fire from the wing-tip pods (as fitStats() does on the web)
        let guns: Vec<Vec3> = def
            .guns
            .iter()
            .map(|g| {
                let p = Vec3::from_array(*g);
                if p.x.abs() < 3.0 {
                    return p;
                }
                built.pods.iter().copied().find(|q| q.x.signum() == p.x.signum()).unwrap_or(p)
            })
            .collect();
        let mut model = ShipModel { nozzles: built.nozzles.clone(), guns, turrets: built.turrets.clone(), ..default() };
        let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        let mut keys: Vec<M> = built.geos.keys().copied().collect();
        keys.sort_by_key(|m| format!("{m:?}"));
        for m in keys {
            let geo = &built.geos[&m];
            if geo.idx.is_empty() {
                continue;
            }
            for p in &geo.pos {
                lo = lo.min(*p);
                hi = hi.max(*p);
            }
            model.triangles += geo.tris();
            model.parts.push(ShipPart {
                mesh: meshes.add(geo.to_mesh(1.0 / tile(m), normal_mapped(m))),
                material: mat_of(m, &mut mats),
                transform: Transform::IDENTITY,
                shadow: casts_shadow(m),
            });
        }
        model.aabb_min = lo;
        model.aabb_max = hi;
        model.extent = lo.abs().max(hi.abs()).max_element();
        if def.capital {
            let t = std::time::Instant::now();
            let hull = capital_hull(kind, &built, model.extent);
            info!("ships: {kind}: hull {} boxes, {:.1} m cells, extent {:.0} m ({:.0?})", hull.boxes.len(), hull.cell, hull.extent, t.elapsed());
            model.hull = Some(Arc::new(hull));
        }
        model.lights = built.lights.iter().map(|l| NavLight { pos: l.pos, rate: l.rate, phase: l.phase, size: l.size, material: mat_of(M::Halo(l.color), &mut mats) }).collect();
        if let Some(tm) = built.turret_mat.filter(|_| !model.turrets.is_empty()) {
            model.turret_head = Some((head_mesh.clone(), mat_of(tm, &mut mats)));
        }
        debug!("ships: {kind}: {} triangles, {} meshes, {} nozzles, {} hull boxes, extent {:.0} m", model.triangles, model.parts.len(), model.nozzles.len(), model.hull.as_ref().map_or(0, |h| h.boxes.len()), model.extent);
        total += model.triangles;
        lib.models.insert(kind.clone(), model);
    }
    info!("ships: {} models, {} triangles, {} materials in {:.2?} (textures {:.2?})", lib.models.len(), total, cache.len(), t0.elapsed(), t_tex);
}

// ---------- capital hull shape (hit tests, collisions) ----------

/// A BVH node with at most this many boxes is a leaf.
const HULL_LEAF: usize = 4;

#[derive(Clone, Copy, Debug)]
struct HullNode {
    lo: Vec3,
    hi: Vec3,
    /// leaf (`count` > 0): index of its first box; inner node: index of the right child (left = node + 1)
    first: u32,
    count: u32,
}

/// A capital hull for hit tests and collisions: solid voxel boxes in body space (centre, half extents),
/// built from the model's hull surfaces with the interior filled and neighbouring cells merged into larger
/// boxes (disjoint), kept in a small bounding-volume tree. The Aurora's flyable hangar tunnel
/// (`AURORA_BAY`) is left open. Queries allocate nothing.
#[derive(Clone, Debug, Default)]
pub struct HullShape {
    pub boxes: Vec<(Vec3, Vec3)>,
    nodes: Vec<HullNode>,
    /// farthest model point from the origin (web `modelR`): broad-phase radius together with `Hittable::radius`
    pub extent: f32,
    /// voxel edge length the boxes were built with (m)
    pub cell: f32,
}

impl HullShape {
    pub fn new(mut boxes: Vec<(Vec3, Vec3)>, extent: f32, cell: f32) -> Self {
        let mut nodes = Vec::with_capacity(boxes.len() / 2 + 1);
        if !boxes.is_empty() {
            Self::build_node(&mut boxes, 0, &mut nodes);
        }
        Self { boxes, nodes, extent, cell }
    }

    fn build_node(items: &mut [(Vec3, Vec3)], offset: usize, nodes: &mut Vec<HullNode>) -> usize {
        let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        let (mut clo, mut chi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        for (c, h) in items.iter() {
            lo = lo.min(*c - *h);
            hi = hi.max(*c + *h);
            clo = clo.min(*c);
            chi = chi.max(*c);
        }
        let idx = nodes.len();
        nodes.push(HullNode { lo, hi, first: offset as u32, count: items.len() as u32 });
        if items.len() <= HULL_LEAF {
            return idx;
        }
        // median split along the longest axis of the box centres
        let span = chi - clo;
        let axis = if span.x >= span.y && span.x >= span.z {
            0
        } else if span.y >= span.z {
            1
        } else {
            2
        };
        items.sort_unstable_by(|a, b| a.0[axis].total_cmp(&b.0[axis]));
        let mid = items.len() / 2;
        let (l, r) = items.split_at_mut(mid);
        Self::build_node(l, offset, nodes);
        let right = Self::build_node(r, offset + mid, nodes);
        nodes[idx] = HullNode { lo, hi, first: right as u32, count: 0 };
        idx
    }

    /// Entry fraction (0..1) of the body-space segment `a`-`b` into the hull grown by `margin` (0 when `a`
    /// starts inside). Exact for the boxes.
    pub fn segment(&self, a: Vec3, b: Vec3, margin: f32) -> Option<f32> {
        if self.nodes.is_empty() {
            return None;
        }
        let d = b - a;
        let safe = |v: f32| if v.abs() < 1e-12 { 1e-12 } else { v };
        let inv = Vec3::new(1.0 / safe(d.x), 1.0 / safe(d.y), 1.0 / safe(d.z));
        let m = Vec3::splat(margin);
        let slab = |lo: Vec3, hi: Vec3, tmax: f32| -> Option<f32> {
            let t1 = (lo - a) * inv;
            let t2 = (hi - a) * inv;
            let t0 = t1.min(t2).max_element().max(0.0);
            (t0 <= t1.max(t2).min_element().min(tmax)).then_some(t0)
        };
        let mut best = 1.0f32;
        let mut found = false;
        let mut stack = [0u32; 64];
        let mut sp = 1;
        while sp > 0 {
            sp -= 1;
            let ni = stack[sp];
            let n = self.nodes[ni as usize];
            if slab(n.lo - m, n.hi + m, best).is_none() {
                continue;
            }
            if n.count > 0 {
                for &(c, h) in &self.boxes[n.first as usize..(n.first + n.count) as usize] {
                    if let Some(t) = slab(c - h - m, c + h + m, best) {
                        best = t;
                        found = true;
                    }
                }
            } else if sp + 2 <= stack.len() {
                stack[sp] = n.first;
                stack[sp + 1] = ni + 1;
                sp += 2;
            }
        }
        found.then_some(best)
    }

    /// Signed distance from the body-space point `p` to the nearest box (negative inside) and the outward
    /// body-space normal there, if it is below `limit`. Exact outside the hull (the boxes are disjoint).
    pub fn distance(&self, p: Vec3, limit: f32) -> Option<(f32, Vec3)> {
        let mut best: Option<(f32, Vec3)> = None;
        let mut bound = limit;
        let mut stack = [0u32; 64];
        let mut sp = usize::from(!self.nodes.is_empty());
        while sp > 0 {
            sp -= 1;
            let ni = stack[sp];
            let n = self.nodes[ni as usize];
            let out = (n.lo - p).max(p - n.hi).max(Vec3::ZERO);
            if out.length() > bound {
                continue;
            }
            if n.count > 0 {
                for &(c, h) in &self.boxes[n.first as usize..(n.first + n.count) as usize] {
                    let (d, nn) = box_sdf(h, p - c);
                    if d < bound {
                        bound = d;
                        best = Some((d, nn));
                    }
                }
            } else if sp + 2 <= stack.len() {
                stack[sp] = n.first;
                stack[sp + 1] = ni + 1;
                sp += 2;
            }
        }
        best
    }

    /// A body-space point inside a random box (`r` three values in 0..1, `pick` 0..1): capital death blasts.
    pub fn random_point(&self, pick: f32, r: Vec3) -> Option<Vec3> {
        let n = self.boxes.len();
        let (c, h) = *self.boxes.get(((pick * n as f32) as usize).min(n.max(1) - 1))?;
        Some(c + h * (r * 2.0 - Vec3::ONE))
    }
}

/// Signed distance to an axis-aligned box (half extents `h`) at the origin, and the outward normal.
fn box_sdf(h: Vec3, l: Vec3) -> (f32, Vec3) {
    let off = l - l.clamp(-h, h);
    let d = off.length();
    if d > 1e-4 {
        return (d, off / d);
    }
    let gap = h - l.abs();
    let s = |v: f32| if v >= 0.0 { 1.0 } else { -1.0 };
    if gap.x < gap.y && gap.x < gap.z {
        (-gap.x, Vec3::X * s(l.x))
    } else if gap.y < gap.z {
        (-gap.y, Vec3::Y * s(l.y))
    } else {
        (-gap.z, Vec3::Z * s(l.z))
    }
}

/// The hull shape of a capital ship type: its solid (shadow-casting) surfaces voxelised at about extent/40
/// (2..6 m cells), the interior filled, the Aurora's hangar tunnel carved out, cells merged into boxes.
fn capital_hull(kind: &str, built: &designs::Built, extent: f32) -> HullShape {
    let solid: Vec<&mesh::Geo> = built.geos.iter().filter(|(m, _)| casts_shadow(**m)).map(|(_, g)| g).collect();
    let cell = (extent / 40.0).clamp(2.0, 6.0);
    // the tunnel plus a metre (the bow ring round the mouth too); it opens forward into space
    let carve = (kind == "aurora").then(|| {
        let b = &AURORA_BAY;
        (Vec3::new(-b.hw - 1.0, b.y - b.hh - 1.0, b.back), Vec3::new(b.hw + 1.0, b.y + b.hh + 1.0, b.mouth + 2.0 * cell))
    });
    HullShape::new(voxel_boxes(&solid, cell, carve), extent, cell)
}

/// Voxelise the triangle surfaces at `cell` metres, fill everything the outside cannot reach (the hull's
/// interior), then clear the cells touching `carve` (body-space box lo, hi) and merge the solid cells greedily
/// into disjoint boxes (runs along x, grown along z, then y).
fn voxel_boxes(geos: &[&mesh::Geo], cell: f32, carve: Option<(Vec3, Vec3)>) -> Vec<(Vec3, Vec3)> {
    let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
    for g in geos {
        for p in &g.pos {
            lo = lo.min(*p);
            hi = hi.max(*p);
        }
    }
    if lo.x > hi.x {
        return Vec::new();
    }
    // one empty cell of padding round the model, so the outside is connected
    let i0 = (lo / cell).floor().as_ivec3() - IVec3::ONE;
    let i1 = (hi / cell).floor().as_ivec3() + IVec3::ONE;
    let dim = i1 - i0 + IVec3::ONE;
    let (nx, ny, nz) = (dim.x as usize, dim.y as usize, dim.z as usize);
    let at = |x: usize, y: usize, z: usize| (z * ny + y) * nx + x;
    // 0 empty, 1 surface, 2 outside (flood fill), 3 carved
    let mut grid = vec![0u8; nx * ny * nz];
    for g in geos {
        for t in g.idx.chunks_exact(3) {
            let (a, b, c) = (g.pos[t[0] as usize], g.pos[t[1] as usize], g.pos[t[2] as usize]);
            let longest = (b - a).length().max((c - b).length()).max((a - c).length());
            let n = ((longest / (cell * 0.5)).ceil() as i32).clamp(1, 256);
            for i in 0..=n {
                for j in 0..=(n - i) {
                    let (u, v) = (i as f32 / n as f32, j as f32 / n as f32);
                    let k = ((a + (b - a) * u + (c - a) * v) / cell).floor().as_ivec3() - i0;
                    grid[at(k.x as usize, k.y as usize, k.z as usize)] = 1;
                }
            }
        }
    }
    // flood the outside from a padding corner (6-neighbourhood): what it cannot reach is the hull's inside
    let mut stack = vec![at(0, 0, 0)];
    grid[at(0, 0, 0)] = 2;
    while let Some(i) = stack.pop() {
        let (x, y, z) = (i % nx, (i / nx) % ny, i / (nx * ny));
        let mut visit = |x: usize, y: usize, z: usize| {
            let j = at(x, y, z);
            if grid[j] == 0 {
                grid[j] = 2;
                stack.push(j);
            }
        };
        if x > 0 {
            visit(x - 1, y, z);
        }
        if x + 1 < nx {
            visit(x + 1, y, z);
        }
        if y > 0 {
            visit(x, y - 1, z);
        }
        if y + 1 < ny {
            visit(x, y + 1, z);
        }
        if z > 0 {
            visit(x, y, z - 1);
        }
        if z + 1 < nz {
            visit(x, y, z + 1);
        }
    }
    // the carved tunnel is cut out of the filled hull afterwards, so the hull round it stays solid
    if let Some((clo, chi)) = carve {
        let eps = 1e-3;
        let a = ((clo / cell).floor().as_ivec3() - i0).max(IVec3::ZERO);
        let b = ((chi / cell).floor().as_ivec3() - i0).min(dim - IVec3::ONE);
        for z in a.z..=b.z {
            for y in a.y..=b.y {
                for x in a.x..=b.x {
                    let c0 = (IVec3::new(x, y, z) + i0).as_vec3() * cell;
                    let c1 = c0 + Vec3::splat(cell);
                    if c1.cmpgt(clo + Vec3::splat(eps)).all() && c0.cmplt(chi - Vec3::splat(eps)).all() {
                        grid[at(x as usize, y as usize, z as usize)] = 3;
                    }
                }
            }
        }
    }
    // greedy merge of the solid cells (surface or enclosed, never carved) into disjoint boxes
    let mut free: Vec<bool> = grid.iter().map(|&v| v == 0 || v == 1).collect();
    let mut out = Vec::new();
    for z in 0..nz {
        for y in 0..ny {
            for x in 0..nx {
                if !free[at(x, y, z)] {
                    continue;
                }
                let mut x1 = x;
                while x1 + 1 < nx && free[at(x1 + 1, y, z)] {
                    x1 += 1;
                }
                let mut z1 = z;
                while z1 + 1 < nz && (x..=x1).all(|xx| free[at(xx, y, z1 + 1)]) {
                    z1 += 1;
                }
                let mut y1 = y;
                while y1 + 1 < ny && (z..=z1).all(|zz| (x..=x1).all(|xx| free[at(xx, y1 + 1, zz)])) {
                    y1 += 1;
                }
                for zz in z..=z1 {
                    for yy in y..=y1 {
                        for xx in x..=x1 {
                            free[at(xx, yy, zz)] = false;
                        }
                    }
                }
                let a = (IVec3::new(x as i32, y as i32, z as i32) + i0).as_vec3() * cell;
                let b = (IVec3::new(x1 as i32 + 1, y1 as i32 + 1, z1 as i32 + 1) + i0).as_vec3() * cell;
                out.push(((a + b) * 0.5, (b - a) * 0.5));
            }
        }
    }
    out
}

#[cfg(test)]
mod hull_tests {
    use super::*;

    fn hull(kind: &str) -> HullShape {
        let data = GameData::load();
        let def = data.ship(kind);
        let mut built = designs::build(kind).expect("model");
        let mounts = designs::turret_mounts(kind, &def.turrets);
        designs::add_turret_domes(&mut built, &mounts);
        let (mut lo, mut hi) = (Vec3::splat(f32::MAX), Vec3::splat(f32::MIN));
        for g in built.geos.values() {
            for p in &g.pos {
                lo = lo.min(*p);
                hi = hi.max(*p);
            }
        }
        capital_hull(kind, &built, lo.abs().max(hi.abs()).max_element())
    }

    #[test]
    fn capital_hulls_are_compact_and_fast() {
        let data = GameData::load();
        let mut kinds: Vec<&String> = data.ships.iter().filter(|(_, d)| d.capital).map(|(k, _)| k).collect();
        kinds.sort();
        for kind in kinds {
            let t = std::time::Instant::now();
            let h = hull(kind);
            let build = t.elapsed();
            // 10k random segments through the hull's bounding sphere
            let mut s = 0x1234_5678u32;
            let mut rnd = || {
                s ^= s << 13;
                s ^= s >> 17;
                s ^= s << 5;
                (s as f32 / u32::MAX as f32) * 2.0 - 1.0
            };
            let t = std::time::Instant::now();
            let mut hits = 0;
            for _ in 0..10_000 {
                let a = Vec3::new(rnd(), rnd(), rnd()) * h.extent;
                let b = a + Vec3::new(rnd(), rnd(), rnd()) * 30.0;
                hits += h.segment(a, b, 2.5).is_some() as u32;
                hits += h.distance(a, 6.0).is_some() as u32;
            }
            println!("{kind}: {} boxes, cell {:.1} m, build {:.1?}, 10k segment+distance queries {:.2?} ({hits} hits)", h.boxes.len(), h.cell, build, t.elapsed());
            assert!(h.boxes.len() < 6000, "{kind}: too many boxes");
        }
    }

    #[test]
    fn aurora_saucer_is_solid_and_bay_open() {
        let h = hull("aurora");
        // saucer centre and a nacelle are solid (not only a shell), the hangar tunnel is free
        assert!(h.distance(Vec3::new(0.0, 12.0, 100.0), 0.0).is_some(), "saucer inside");
        assert!(h.distance(Vec3::new(64.0, 16.0, -102.0), 0.0).is_some(), "nacelle inside");
        let b = &AURORA_BAY;
        for z in [b.back + 8.0, (b.back + b.mouth) * 0.5, b.mouth - 2.0, b.mouth + 10.0] {
            let p = Vec3::new(0.0, b.y, z);
            let d = h.distance(p, 100.0).map_or(100.0, |d| d.0);
            assert!(d > b.hh - 0.5, "bay blocked at z {z}: {d}");
        }
        // a bolt along the tunnel's centre line flies in without hitting anything before the back wall
        let t = h.segment(Vec3::new(0.0, b.y, b.mouth + 200.0), Vec3::new(0.0, b.y, b.back - 50.0), 0.0).expect("back wall");
        let z = b.mouth + 200.0 + (b.back - 50.0 - b.mouth - 200.0) * t;
        assert!(z < b.back + 1.0, "tunnel blocked at z {z}");
        // the saucer rim and the nacelles are hit from the side
        let t = h.segment(Vec3::new(400.0, 12.0, 100.0), Vec3::new(-400.0, 12.0, 100.0), 0.0).expect("saucer");
        let x = 400.0 - 800.0 * t;
        assert!((x - 110.0).abs() < 8.0, "saucer rim at x {x}");
        assert!(h.segment(Vec3::new(64.0, 300.0, -102.0), Vec3::new(64.0, -300.0, -102.0), 0.0).is_some(), "nacelle");
    }
}

// ---------- spawning ----------

/// Height of a turret's barrels above its mount on the hull (the head sits 1.2 m up, barrels ~1.9 m above that).
const TURRET_MUZZLE: f32 = 3.0;

fn spawn_body(p: &mut ChildSpawnerCommands, lib: &ShipLibrary, model: Option<&ShipModel>) {
    let root = p.target_entity();
    p.spawn((ShipBody, Transform::default(), Visibility::default())).with_children(|b| {
        let Some(model) = model else { return };
        for part in &model.parts {
            let mut e = b.spawn((Mesh3d(part.mesh.clone()), MeshMaterial3d(part.material.clone()), part.transform));
            if !part.shadow {
                e.insert(NotShadowCaster);
            }
        }
        for &(pos, radius) in &model.nozzles {
            b.spawn((EngineNozzle { radius }, Transform::from_translation(pos)));
        }
        for (idx, &pos) in model.guns.iter().enumerate() {
            b.spawn((Muzzle { idx }, Transform::from_translation(pos)));
        }
        for (idx, &(pos, n)) in model.turrets.iter().enumerate() {
            // +Y outward, +Z the ship's forward projected onto the hull
            let mut fwd = Vec3::Z - n * n.z;
            if fwd.length_squared() < 1e-4 {
                fwd = Vec3::Y - n * n.y;
            }
            let rot = Quat::from_mat3(&Mat3::from_cols(n.cross(fwd.normalize()), n, fwd.normalize()));
            let mut t = b.spawn((Turret { idx }, Transform::from_translation(pos).with_rotation(rot), Visibility::default()));
            if let Some((mesh, mat)) = &model.turret_head {
                t.with_child((TurretHead { idx, ship: root, base: rot }, Mesh3d(mesh.clone()), MeshMaterial3d(mat.clone()), Transform::from_xyz(0.0, 1.2, 0.0)));
            }
        }
        for l in &model.lights {
            b.spawn((
                Blinker { rate: l.rate, phase: l.phase },
                Mesh3d(lib.halo_mesh.clone()),
                MeshMaterial3d(l.material.clone()),
                Transform::from_translation(l.pos).with_scale(Vec3::splat(l.size)),
                Visibility::Hidden,
                NotShadowCaster,
            ));
        }
    });
}

/// Spawn a ship of `kind` (key of ships.json) at `transform`. The returned entity carries `Ship`, `Hittable`,
/// `InMission`, `Transform`/`Visibility`; its model is a child with `ShipBody` (banking rotates only the body),
/// engine nozzles are `EngineNozzle` children of the body, guns `Muzzle`, capital turrets `Turret`.
pub fn spawn_ship(commands: &mut Commands, lib: &ShipLibrary, data: &GameData, kind: &str, transform: Transform) -> Entity {
    let def = data.ship(kind).clone();
    let mut ship = Ship::new(kind, &def);
    // the ship fires from its model's gun ports (wing guns snapped to the pods) and from the turret heads
    // on the hull (web fitStats / ships.js turret projection); a kind drawn with the fallback model keeps
    // its raw positions
    if let Some(m) = lib.models.get(kind) {
        if m.guns.len() == ship.def.guns.len() {
            ship.def.guns = m.guns.iter().map(|g| g.to_array()).collect();
        }
        if m.turrets.len() == ship.def.turrets.len() {
            ship.def.turrets = m.turrets.iter().map(|(p, n)| (*p + *n * TURRET_MUZZLE).to_array()).collect();
        }
    }
    let r = ship.radius();
    let half = def.hull_box.map(|b| Vec3::new(b[0], b[1], b[2]));
    let name = def.name.clone();
    let model = lib.model(kind);
    let mut e = commands.spawn((ship, Hittable { radius: r, half_extents: half }, InMission, transform, Visibility::default(), Name::new(name)));
    if let Some(h) = model.filter(|_| def.capital).and_then(|m| m.hull.clone()) {
        e.insert(HullBoxes(h));
    }
    e.with_children(|p| spawn_body(p, lib, model)).id()
}

/// Visual-only ship (menus, cutscenes, showcases): a root with the same `ShipBody` hierarchy as `spawn_ship`,
/// but no `Ship`/`Hittable`/`InMission`, so no gameplay system touches it.
pub fn spawn_ship_model(commands: &mut Commands, lib: &ShipLibrary, kind: &str, transform: Transform) -> Entity {
    let model = lib.model(kind);
    commands.spawn((transform, Visibility::default(), Name::new(format!("Modell {kind}")))).with_children(|p| spawn_body(p, lib, model)).id()
}

// ---------- nav lights ----------

/// Blink the nav lights (web: visible while frac(t * rate + phase) < 0.14) and turn their halos to the camera.
/// Runs after transform propagation and writes the final GlobalTransform, so the billboard never lags.
fn blink_lights(time: Res<Time>, showcase: Option<Res<Showcase>>, cam: Query<&GlobalTransform, With<MainCamera>>, mut q: Query<(&Blinker, &mut Visibility, &mut GlobalTransform), Without<MainCamera>>) {
    let t = time.elapsed_secs_wrapped();
    let cam_rot = cam.single().map(|c| c.rotation()).unwrap_or(Quat::IDENTITY);
    for (b, mut vis, mut gt) in &mut q {
        let on = showcase.as_ref().is_some_and(|s| s.lights_on) || (t * b.rate + b.phase).fract() < 0.14;
        vis.set_if_neq(if on { Visibility::Inherited } else { Visibility::Hidden });
        if on {
            let (s, _, p) = gt.to_scale_rotation_translation();
            *gt = GlobalTransform::from(Transform { translation: p, rotation: cam_rot, scale: s });
        }
    }
}

// ---------- showcase test hook ----------

#[derive(Resource, Clone)]
struct Showcase {
    kinds: Vec<String>,
    yaw: f32,
    pitch: f32,
    spin: f32,
    dist: Option<f32>,
    /// scale every model to its grid cell (mixed capital sizes)
    fit: bool,
    /// nav lights permanently on (SF_SHOWCASE_LIGHTS=1)
    lights_on: bool,
}

impl Showcase {
    fn from_env() -> Option<Self> {
        let v = std::env::var("SF_SHOWCASE").ok()?;
        let all = ship_preview_kinds();
        let kinds: Vec<String> = match v.as_str() {
            "" | "0" => return None,
            "1" | "fighters" => all[..10].iter().map(|s| s.to_string()).collect(),
            "capitals" => all[10..].iter().map(|s| s.to_string()).collect(),
            "all" => all.iter().map(|s| s.to_string()).collect(),
            list => list.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        };
        let num = |k: &str| std::env::var(k).ok().and_then(|s| s.parse::<f32>().ok());
        let fit = kinds.len() > 1 && kinds.iter().any(|k| !all[..10].contains(&k.as_str()));
        Some(Self { kinds, yaw: num("SF_SHOWCASE_YAW").unwrap_or(55.0).to_radians(), pitch: num("SF_SHOWCASE_PITCH").unwrap_or(22.0).to_radians(), spin: num("SF_SHOWCASE_SPIN").unwrap_or(0.0).to_radians(), dist: num("SF_SHOWCASE_DIST"), fit, lights_on: num("SF_SHOWCASE_LIGHTS").is_some_and(|v| v > 0.0) })
    }
}

#[derive(Component)]
struct ShowcaseRoot {
    dist: f32,
}

#[derive(Component)]
struct ShowcaseItem {
    base: Quat,
}

fn showcase_spawn(mut commands: Commands, cfg: Res<Showcase>, lib: Res<ShipLibrary>) {
    let n = cfg.kinds.len().max(1);
    let cols = match n {
        0..=3 => n,
        4 => 2,
        _ => ((n as f32 * 1.8).sqrt().ceil() as usize).min(n),
    };
    let rows = n.div_ceil(cols);
    let extents: Vec<f32> = cfg.kinds.iter().map(|k| lib.model(k).map_or(10.0, |m| m.extent)).collect();
    let cell = if cfg.fit { 2.4 } else { extents.iter().fold(0.0f32, |m, e| m.max(*e)) * if n == 1 { 1.9 } else { 2.3 } };
    // root space = camera space (+X right, +Y up, camera at +Z): yaw 0 = nose towards the camera
    let base = Quat::from_rotation_x(cfg.pitch) * Quat::from_rotation_y(cfg.yaw);
    let width = cols as f32 * cell;
    let height = rows as f32 * cell;
    // vertical fov 45 degrees (visible height = 0.83 x distance), 16:9; keep a margin
    let dist = cfg.dist.unwrap_or_else(|| (height / 0.72).max(width / 1.3));
    let root = commands.spawn((ShowcaseRoot { dist }, InMission, Transform::default(), Visibility::default(), Name::new("Showcase"))).id();
    for (i, kind) in cfg.kinds.iter().enumerate() {
        let (c, r) = (i % cols, i / cols);
        let x = (c as f32 - (cols - 1) as f32 * 0.5) * cell;
        let y = ((rows - 1) as f32 * 0.5 - r as f32) * cell;
        let scale = if cfg.fit { 1.0 / extents[i].max(1.0) } else { 1.0 };
        let e = spawn_ship_model(&mut commands, &lib, kind, Transform::from_xyz(x, y, 0.0).with_rotation(base).with_scale(Vec3::splat(scale)));
        commands.entity(e).insert(ShowcaseItem { base });
        commands.entity(root).add_child(e);
    }
    // studio lighting: dark backdrop, cool rim light, some ambient fill
    commands.insert_resource(ClearColor(Color::srgb(0.01, 0.012, 0.02)));
    commands.insert_resource(GlobalAmbientLight { color: Color::srgb(0.6, 0.65, 0.8), brightness: 250.0, ..default() });
    commands.entity(root).with_child((DirectionalLight { illuminance: 5000.0, color: Color::srgb(0.7, 0.8, 1.0), ..default() }, Transform::from_xyz(1.0, 0.8, -1.5).looking_at(Vec3::ZERO, Vec3::Y)));
    commands.entity(root).with_child((DirectionalLight { illuminance: 9000.0, color: Color::srgb(1.0, 0.95, 0.88), ..default() }, Transform::from_xyz(-1.2, 1.5, 1.6).looking_at(Vec3::ZERO, Vec3::Y)));
    info!("showcase: {} models, {cols}x{rows}, cell {cell:.0} m, distance {dist:.0} m", n);
}

fn showcase_hide_player(players: Query<&Children, With<Player>>, mut bodies: Query<&mut Visibility, With<ShipBody>>) {
    for children in &players {
        for c in children.iter() {
            if let Ok(mut v) = bodies.get_mut(c) {
                v.set_if_neq(Visibility::Hidden);
            }
        }
    }
}

/// Keep the showcase centred in the camera's view. The offset is taken from the camera's and the player's
/// GlobalTransforms (a consistent pair from the last propagation) and applied to the player's current
/// Transform, so it does not lag behind a moving player whatever order the camera system runs in.
fn showcase_follow(
    time: Res<Time>,
    cfg: Res<Showcase>,
    player: Query<(&Transform, &GlobalTransform), (With<Player>, Without<ShowcaseRoot>, Without<ShowcaseItem>)>,
    cam: Query<&GlobalTransform, (With<MainCamera>, Without<ShowcaseRoot>, Without<ShowcaseItem>)>,
    mut root: Query<(&ShowcaseRoot, &mut Transform), Without<ShowcaseItem>>,
    mut items: Query<(&ShowcaseItem, &mut Transform), Without<ShowcaseRoot>>,
) {
    let Ok(cam) = cam.single() else { return };
    for (r, mut t) in &mut root {
        let view = Transform { translation: cam.translation() + cam.rotation() * Vec3::NEG_Z * r.dist, rotation: cam.rotation(), scale: Vec3::ONE };
        *t = match player.iter().next() {
            Some((pt, pg)) => {
                let rel = pg.compute_transform().compute_affine().inverse() * view.compute_affine();
                Transform::from_matrix(pt.compute_affine().into()) * Transform::from_matrix(rel.into())
            }
            None => view,
        };
    }
    if cfg.spin != 0.0 {
        let spin = Quat::from_rotation_y(time.elapsed_secs() * cfg.spin);
        for (it, mut t) in &mut items {
            t.rotation = it.base * spin;
        }
    }
}
