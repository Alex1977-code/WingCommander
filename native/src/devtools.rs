//! Test hooks driven by environment variables (used by automated screenshot runs, harmless otherwise):
//! - SF_MISSION=<index>  skip the menu and start that mission (0 = first)
//! - SF_VIEW=chase       start in the chase view
//! - SF_SHOT=<file.png>  save a screenshot after SF_SHOT_AT seconds (default 6) of flight, then quit
//! - SF_QUIT_AT=<secs>   quit after that many seconds (without a screenshot)
//! - SF_WINDOW=<w>x<h>   window size (e.g. 2560x1080 to test ultra-wide layouts)

use crate::common::*;
use bevy::prelude::*;
use bevy::render::view::screenshot::{save_to_disk, Screenshot, ScreenshotCaptured};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct DevToolsPlugin;

#[derive(Resource, Default)]
struct DevRun {
    t: f32,
    shot_taken: bool,
    quit_t: Option<f32>,
    /// set by the screenshot observer once the png is written
    saved: Arc<AtomicBool>,
}

impl Plugin for DevToolsPlugin {
    fn build(&self, app: &mut App) {
        if ["SF_MISSION", "SF_SHOT", "SF_QUIT_AT", "SF_WINDOW"].iter().all(|v| std::env::var(v).is_err()) {
            return;
        }
        app.init_resource::<DevRun>().add_systems(Startup, dev_start).add_systems(Update, dev_tick);
    }
}

fn dev_start(
    mut progress: ResMut<Progress>,
    mut settings: ResMut<Settings>,
    mut next: ResMut<NextState<AppState>>,
    mut windows: Query<&mut Window, With<bevy::window::PrimaryWindow>>,
) {
    let size = std::env::var("SF_WINDOW").ok().and_then(|s| {
        let (w, h) = s.split_once('x')?;
        Some((w.parse::<u32>().ok()?, h.parse::<u32>().ok()?))
    });
    if let (Some((w, h)), Ok(mut win)) = (size, windows.single_mut()) {
        win.resolution.set_physical_resolution(w, h);
    }
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
            let saved = run.saved.clone();
            commands
                .spawn(Screenshot::primary_window())
                .observe(save_to_disk(path))
                .observe(move |_: On<ScreenshotCaptured>| saved.store(true, Ordering::Release));
            // quit once the png is on disk (slow software renderers can take several frames); give up after 30 s
            run.quit_t = Some(run.t + 30.0);
        }
        if run.shot_taken && run.saved.load(Ordering::Acquire) {
            run.quit_t = Some(run.quit_t.map_or(run.t, |q| q.min(run.t + 0.2)));
        }
    }
    if let Some(q) = std::env::var("SF_QUIT_AT").ok().and_then(|s| s.parse::<f32>().ok()) {
        run.quit_t = Some(run.quit_t.map_or(q, |x| x.min(q)));
    }
    if run.quit_t.is_some_and(|q| run.t >= q) {
        exit.write(AppExit::Success);
    }
}
