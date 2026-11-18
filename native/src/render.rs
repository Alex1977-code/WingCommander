//! Graphics (owner: render agent). PLACEHOLDER: a camera behind the player and a sun.
use crate::common::*;
use bevy::prelude::*;

pub struct GraphicsPlugin;

impl Plugin for GraphicsPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup).add_systems(PostUpdate, follow.before(TransformSystems::Propagate));
    }
}

fn setup(mut commands: Commands) {
    commands.spawn((Camera3d::default(), MainCamera, Transform::from_xyz(0.0, 8.0, -30.0)));
    commands.spawn((DirectionalLight { illuminance: 8000.0, ..default() }, Transform::from_xyz(1.0, 2.0, 1.5).looking_at(Vec3::ZERO, Vec3::Y)));
}

fn follow(player: Query<&Transform, (With<Player>, Without<MainCamera>)>, mut cam: Query<&mut Transform, With<MainCamera>>) {
    let (Ok(p), Ok(mut c)) = (player.single(), cam.single_mut()) else { return };
    let f = fwd(p);
    let up = p.rotation * Vec3::Y;
    c.translation = p.translation - f * 30.0 + up * 8.0;
    c.look_at(p.translation + f * 50.0, up);
}
