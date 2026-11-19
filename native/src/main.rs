//! Sternenfront – Der Perseus-Krieg, native PC version (Bevy, Vulkan, NVIDIA DLSS).
//! Same campaign and ship data as the browser version (assets/data, exported from ../src).

// release builds on Windows start without a console window
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod audio;
mod cockpit;
mod common;
mod devtools;
mod flight;
mod fx;
mod hud;
mod menu;
mod mission;
mod render;
mod ships;
mod weapons;

use bevy::anti_alias::dlss::DlssProjectId;
use bevy::prelude::*;
use bevy::window::{PresentMode, WindowMode};
use common::*;

/// Project id NVIDIA's DLSS runtime identifies the game by.
const DLSS_PROJECT: bevy::asset::uuid::Uuid = bevy::asset::uuid::uuid!("5b2f0c3e-6a51-4d7e-9a0e-3c1f7d2a9b44");

fn main() {
    // release builds have no console: write panics to %APPDATA%\Sternenfront\absturz.log
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::write(
            save_dir().join("absturz.log"),
            format!("{info}\n\n{}", std::backtrace::Backtrace::force_capture()),
        );
        prev(info);
    }));
    let settings: Settings = load_json("settings.json");
    let progress: Progress = load_json("progress.json");
    let data = GameData::load();
    App::new()
        // with the `dlss` feature Bevy creates a raw Vulkan instance (needed by DLSS) and falls back to
        // DX12/other backends only when Vulkan is unavailable; then render.rs uses TAA/FXAA
        .insert_resource(DlssProjectId(DLSS_PROJECT))
        .add_plugins(
            DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "Sternenfront – Der Perseus-Krieg".into(),
                        present_mode: PresentMode::AutoVsync,
                        mode: if settings.fullscreen { WindowMode::BorderlessFullscreen(MonitorSelection::Primary) } else { WindowMode::Windowed },
                        ..default()
                    }),
                    ..default()
                }),
        )
        .insert_resource(settings)
        .insert_resource(progress)
        .insert_resource(data)
        .init_resource::<MissionStatus>()
        .init_resource::<DlssAvailable>()
        .init_resource::<Paused>()
        .init_state::<AppState>()
        .add_message::<DamageMsg>()
        .add_message::<KilledMsg>()
        .add_message::<ExplodeMsg>()
        .add_message::<HitFxMsg>()
        .add_message::<CommMsg>()
        .add_message::<SfxMsg>()
        .add_message::<MissionEndMsg>()
        .add_plugins((
            render::GraphicsPlugin,
            ships::ShipsPlugin,
            flight::FlightPlugin,
            weapons::WeaponsPlugin,
            ai::AiPlugin,
            mission::MissionPlugin,
            hud::HudPlugin,
            menu::MenuPlugin,
            fx::FxPlugin,
            audio::SfxPlugin,
            cockpit::CockpitPlugin,
        ))
        .add_plugins(devtools::DevToolsPlugin)
        .run();
}
