//! Sternenfront – Der Perseus-Krieg, native PC version (Bevy, Vulkan, NVIDIA DLSS).
//! Same campaign and ship data as the browser version (assets/data, exported from ../src).

mod ai;
mod audio;
mod common;
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
use bevy::render::RenderPlugin;
use bevy::render::settings::{Backends, RenderCreation, WgpuSettings};
use bevy::window::{PresentMode, WindowMode};
use common::*;

/// Project id NVIDIA's DLSS runtime identifies the game by.
const DLSS_PROJECT: bevy::asset::uuid::Uuid = bevy::asset::uuid::uuid!("5b2f0c3e-6a51-4d7e-9a0e-3c1f7d2a9b44");

fn main() {
    let settings: Settings = load_json("settings.json");
    let progress: Progress = load_json("progress.json");
    let data = GameData::load();
    App::new()
        // DLSS only exists on the Vulkan backend: request it (wgpu picks DX12 on Windows otherwise)
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
                })
                .set(RenderPlugin {
                    render_creation: RenderCreation::Automatic(WgpuSettings { backends: Some(Backends::VULKAN), ..default() }),
                    ..default()
                }),
        )
        .insert_resource(settings)
        .insert_resource(progress)
        .insert_resource(data)
        .init_resource::<MissionStatus>()
        .init_resource::<DlssAvailable>()
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
        ))
        .run();
}
