//! Mission flow (owner: ai+mission agent). PLACEHOLDER: spawns the player and two Dorns ahead.
use crate::common::*;
use crate::ships::{spawn_ship, ShipLibrary};
use bevy::prelude::*;

pub struct MissionPlugin;

impl Plugin for MissionPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(OnEnter(AppState::Flight), start_mission).add_systems(OnExit(AppState::Flight), cleanup);
    }
}

fn start_mission(mut commands: Commands, lib: Res<ShipLibrary>, data: Res<GameData>, progress: Res<Progress>, mut status: ResMut<MissionStatus>) {
    let m = data.mission(progress.current);
    let player = spawn_ship(&mut commands, &lib, &data, &m.ship, Transform::default());
    commands.entity(player).insert(Player { throttle: 0.75, energy: 1.0, ..default() });
    for i in 0..2 {
        spawn_ship(&mut commands, &lib, &data, "dorn", Transform::from_xyz(-30.0 + 60.0 * i as f32, 10.0, 400.0).looking_to(Vec3::NEG_Z, Vec3::Y));
    }
    *status = MissionStatus { mission: progress.current, objective: "Vernichte alle Feinde".into(), ..default() };
}

fn cleanup(mut commands: Commands, q: Query<Entity, With<InMission>>) {
    for e in &q {
        commands.entity(e).despawn();
    }
}
