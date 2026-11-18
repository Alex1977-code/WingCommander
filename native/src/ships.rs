//! Ship models (owner: ships agent). PLACEHOLDER: capsules until the procedural models exist.
//! Contract used by other modules: `ShipLibrary` (built at Startup) and `spawn_ship()`.

use crate::common::*;
use bevy::prelude::*;

pub struct ShipsPlugin;

impl Plugin for ShipsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ShipLibrary>().add_systems(Startup, build_library);
    }
}

/// Meshes and materials for every ship type, built once.
#[derive(Resource, Default)]
pub struct ShipLibrary {
    pub placeholder: Option<(Handle<Mesh>, Handle<StandardMaterial>, Handle<StandardMaterial>)>,
}

fn build_library(mut lib: ResMut<ShipLibrary>, mut meshes: ResMut<Assets<Mesh>>, mut mats: ResMut<Assets<StandardMaterial>>) {
    let mesh = meshes.add(Capsule3d::new(1.0, 3.0).mesh().build().rotated_by(Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)));
    let ally = mats.add(StandardMaterial { base_color: Color::srgb(0.7, 0.75, 0.85), metallic: 0.7, perceptual_roughness: 0.35, ..default() });
    let foe = mats.add(StandardMaterial { base_color: Color::srgb(0.55, 0.2, 0.35), metallic: 0.5, perceptual_roughness: 0.4, ..default() });
    lib.placeholder = Some((mesh, ally, foe));
}

/// Spawn a ship of `kind` (key of ships.json) at `transform`. The returned entity carries `Ship`, `Hittable`,
/// `InMission`, `Transform`/`Visibility`; its model is a child with `ShipBody` (banking rotates only the body),
/// engine nozzles are `EngineNozzle` children of the body.
pub fn spawn_ship(commands: &mut Commands, lib: &ShipLibrary, data: &GameData, kind: &str, transform: Transform) -> Entity {
    let def = data.ship(kind).clone();
    let ship = Ship::new(kind, &def);
    let r = ship.radius();
    let half = def.hull_box.map(|b| Vec3::new(b[0], b[1], b[2]));
    let (mesh, ally, foe) = lib.placeholder.clone().expect("ShipLibrary not built");
    let mat = if ship.team == Team::Aszendenz { foe } else { ally };
    let scale = if def.capital { half.map_or(r * 0.3, |h| h.max_element() * 0.4) } else { r * 0.45 };
    let team = ship.team;
    commands
        .spawn((ship, Hittable { radius: r, half_extents: half }, InMission, transform, Visibility::default(), Name::new(def.name.clone())))
        .with_children(|p| {
            p.spawn((ShipBody, Transform::default(), Visibility::default())).with_children(|b| {
                b.spawn((Mesh3d(mesh), MeshMaterial3d(mat), Transform::from_scale(Vec3::splat(scale))));
                b.spawn((EngineNozzle { radius: scale * 0.5 }, Transform::from_xyz(0.0, 0.0, -scale * 2.6)));
            });
            let _ = team;
        })
        .id()
}
