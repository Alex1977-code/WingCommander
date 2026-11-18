//! Test hooks driven by environment variables (used by automated screenshot runs, harmless otherwise):
//! - SF_MISSION=<index>  skip the menu and start that mission (0 = first)
//! - SF_VIEW=chase       start in the chase view
//! - SF_SHOT=<file.png>  save a screenshot after SF_SHOT_AT seconds (default 6) of flight, then quit
//! - SF_QUIT_AT=<secs>   quit after that many seconds (without a screenshot)

use crate::common::*;
use bevy::prelude::*;
use bevy::render::view::screenshot::{save_to_disk, Screenshot};

pub struct DevToolsPlugin;

#[derive(Resource, Default)]
struct DevRun {
    t: f32,
    shot_taken: bool,
    quit_t: Option<f32>,
}

impl Plugin for DevToolsPlugin {
    fn build(&self, app: &mut App) {
        if std::env::var("SF_MISSION").is_err() && std::env::var("SF_SHOT").is_err() && std::env::var("SF_QUIT_AT").is_err() {
            return;
        }
        app.init_resource::<DevRun>().add_systems(Startup, dev_start).add_systems(Update, dev_tick);
    }
}

fn dev_start(mut progress: ResMut<Progress>, mut settings: ResMut<Settings>, mut next: ResMut<NextState<AppState>>) {
    if let Some(m) = std::env::var("SF_MISSION").ok().and_then(|s| s.parse::<usize>().ok()) {
        progress.current = m;
        next.set(AppState::Flight);
    }
    if std::env::var("SF_VIEW").map(|v| v == "chase").unwrap_or(false) {
        settings.view = View::Chase;
    }
    settings.fullscreen = false;
}

fn dev_tick(mut commands: Commands, time: Res<Time>, mut run: ResMut<DevRun>, state: Res<State<AppState>>, mut exit: MessageWriter<AppExit>) {
    // count flight time when a mission was requested, wall time otherwise
    if std::env::var("SF_MISSION").is_err() || *state.get() == AppState::Flight {
        run.t += time.delta_secs();
    }
    let shot_at = std::env::var("SF_SHOT_AT").ok().and_then(|s| s.parse::<f32>().ok()).unwrap_or(6.0);
    if let Ok(path) = std::env::var("SF_SHOT") {
        if !run.shot_taken && run.t >= shot_at {
            run.shot_taken = true;
            commands.spawn(Screenshot::primary_window()).observe(save_to_disk(path));
            run.quit_t = Some(run.t + 1.5);
        }
    }
    if let Some(q) = std::env::var("SF_QUIT_AT").ok().and_then(|s| s.parse::<f32>().ok()) {
        run.quit_t = Some(run.quit_t.map_or(q, |x| x.min(q)));
    }
    if run.quit_t.is_some_and(|q| run.t >= q) {
        exit.write(AppExit::Success);
    }
}
