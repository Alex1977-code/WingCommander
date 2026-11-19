//! Menus (bevy_ui): title screen over render.rs' 3D backdrop, mission select, settings, controls, briefing,
//! debrief and the pause overlay. Keyboard (arrows/WASD, Enter, Esc), mouse (hover + click, right click
//! steps a value back) and gamepad (D-pad / left stick, A, B) all drive the same focus model.
//!
//! Owns `Progress` (campaign position, saved to progress.json), the story state (`mission::StorySave`,
//! story.json: flags, wingman affinity, score) and `Settings` changes (settings.json). The campaign rules
//! follow the web onMissionEnd(): see `catch_mission_end`.

use crate::common::*;
use crate::flight::FlightSet;
use crate::mission::{wing_for, MissionResult, StorySave, STORY_FILE};
use crate::hud::{
    AMBER, CYAN, DIM, GREEN, INK, LINE, MUTED, ORANGE, PANEL, RED, UiFonts, WHITE, abs_node, char_color, corner_accents, decoded, display_safe, label,
};
use bevy::ecs::system::SystemParam;
use bevy::picking::events::{PointerClick, PointerMove};
use bevy::picking::pointer::PointerButton;
use bevy::prelude::*;
use bevy::text::Justify;
use bevy::window::{PrimaryWindow, WindowMode};
use std::collections::HashMap;
use std::f32::consts::TAU;

const fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::srgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, a)
}

pub struct MenuPlugin;

impl Plugin for MenuPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<MenuNav>()
            .init_resource::<Shown>()
            .init_resource::<Focus>()
            .init_resource::<Debriefing>()
            .init_resource::<RestartPending>()
            .insert_resource(Campaign2::load())
            .insert_resource(Story(load_json(STORY_FILE)))
            .add_message::<MenuEvent>()
            // nothing else may see a stale pause once the mission is over
            .add_systems(OnExit(AppState::Flight), |mut p: ResMut<Paused>| p.0 = false)
            .add_systems(
                Update,
                (ui_test_hook, catch_mission_end, pause_settings_back, sync_screen, menu_input, menu_actions, button_looks, animate)
                    .chain()
                    .after(FlightSet::Input),
            )
            .add_systems(Update, restart_flight.run_if(in_state(AppState::Briefing)))
            .add_systems(Update, apply_window_mode.run_if(resource_changed::<Settings>))
            .add_systems(PreUpdate, key_script.after(bevy::input::InputSystems).run_if(|| std::env::var("SF_UI_KEYS").is_ok()));
    }
}

// ---------- state ----------

/// Which sub-screen of the title menu is open, and whether the settings are open over the pause screen.
#[derive(Resource, Default)]
struct MenuNav {
    menu: MenuScreen,
    pause_settings: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum MenuScreen {
    #[default]
    Title,
    Missions,
    Settings,
    Controls,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Screen {
    Title,
    Missions,
    Settings,
    Controls,
    Briefing,
    Debrief,
    Pause,
}

/// The screen currently built, its root and how long it has been open.
#[derive(Resource, Default)]
struct Shown {
    screen: Option<Screen>,
    root: Option<Entity>,
    age: f32,
    /// rebuild the same screen (a setting changed); keeps the focus
    dirty: bool,
}

#[derive(Resource, Default)]
struct Focus {
    entity: Option<Entity>,
    /// focus order to restore after a rebuild
    restore: Option<usize>,
}

/// Player statistics of the finished mission (from `mission::MissionResult`).
#[derive(Default, Clone, Copy)]
struct FlightStats {
    kills: u32,
    shots: u32,
    hits: u32,
    time: f32,
    score: u32,
}

/// Persistent story state (owner: menu.rs; saved to story.json, read by mission.rs at mission start).
#[derive(Resource, Default)]
struct Story(StorySave);

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
enum Outcome {
    Win,
    /// objective lost but the story goes on (campaign.json `lose`)
    Branch,
    #[default]
    Lose,
}

/// What the debrief shows.
#[derive(Resource, Default, Clone)]
struct Debriefing {
    mission: usize,
    outcome: Outcome,
    reason: String,
    title: String,
    lines: Vec<Line>,
    stats: FlightStats,
    next: Option<usize>,
    total_kills: u32,
    rank: String,
    promoted: bool,
}

/// "Mission neu starten" from the pause screen: Flight -> Briefing -> straight back into Flight.
#[derive(Resource, Default)]
struct RestartPending(bool);

/// Campaign fields the shared `Campaign` type does not carry (ranks, mission ids, conditional story lines,
/// story flags a mission sets).
#[derive(Resource, Default)]
struct Campaign2 {
    ranks: Vec<(u32, String)>,
    ids: HashMap<String, usize>,
    texts: Vec<MissionTexts>,
}

/// A dialogue line with its conditions (web: `if` / `ifNot` story flags, `aff: [who, min]` affinity).
#[derive(Clone, Default, Debug)]
struct StoryLine {
    who: String,
    text: String,
    cond_if: Option<String>,
    cond_not: Option<String>,
    aff: Option<(String, i32)>,
}

impl StoryLine {
    /// web lineVisible()
    fn visible(&self, story: &StorySave) -> bool {
        self.cond_if.as_ref().is_none_or(|f| story.flags.contains(f))
            && self.cond_not.as_ref().is_none_or(|f| !story.flags.contains(f))
            && self.aff.as_ref().is_none_or(|(w, n)| story.aff.get(w).copied().unwrap_or(0) >= *n)
    }
}

#[derive(Default)]
struct MissionTexts {
    briefing: Vec<StoryLine>,
    win: Vec<StoryLine>,
    lose: Vec<StoryLine>,
    /// flags set on a win (`set`) and on the story branch (`lose.set`)
    set: Vec<String>,
    lose_set: Vec<String>,
}

fn story_lines(v: &serde_json::Value) -> Vec<StoryLine> {
    let s = |l: &serde_json::Value, k: &str| l[k].as_str().map(str::to_string);
    v.as_array()
        .map(|a| {
            a.iter()
                .map(|l| StoryLine {
                    who: s(l, "who").unwrap_or_default(),
                    text: s(l, "text").unwrap_or_default(),
                    cond_if: s(l, "if"),
                    cond_not: s(l, "ifNot"),
                    aff: l["aff"].as_array().and_then(|a| Some((a.first()?.as_str()?.to_string(), a.get(1)?.as_i64()? as i32))),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// keys of a `set` object whose value is true
fn set_flags(v: &serde_json::Value) -> Vec<String> {
    v.as_object().map(|o| o.iter().filter(|(_, v)| v.as_bool() == Some(true)).map(|(k, _)| k.clone()).collect()).unwrap_or_default()
}

impl Campaign2 {
    fn load() -> Self {
        let v: serde_json::Value =
            std::fs::read_to_string(data_dir().join("campaign.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let ranks = v["ranks"]
            .as_array()
            .map(|a| a.iter().filter_map(|r| Some((r[0].as_u64()? as u32, r[1].as_str()?.to_string()))).collect())
            .unwrap_or_default();
        let ids = v["missions"]
            .as_array()
            .map(|a| a.iter().enumerate().filter_map(|(i, m)| Some((m["id"].as_str()?.to_string(), i))).collect())
            .unwrap_or_default();
        let texts = v["missions"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|m| MissionTexts {
                        briefing: story_lines(&m["briefing"]),
                        win: story_lines(&m["win"]),
                        lose: story_lines(&m["lose"]["lines"]),
                        set: set_flags(&m["set"]),
                        lose_set: set_flags(&m["lose"]["set"]),
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { ranks, ids, texts }
    }
    fn texts(&self, idx: usize) -> Option<&MissionTexts> {
        self.texts.get(idx)
    }
    fn rank(&self, kills: u32) -> String {
        self.ranks.iter().filter(|(k, _)| *k <= kills).last().map(|(_, r)| r.clone()).unwrap_or_else(|| "Fähnrich".into())
    }
    fn index(&self, v: Option<&serde_json::Value>) -> Option<usize> {
        v.and_then(|v| v.as_str()).and_then(|id| self.ids.get(id).copied())
    }
}

/// The lines the story state lets through, as plain dialogue lines.
fn visible_lines(lines: &[StoryLine], story: &StorySave) -> Vec<Line> {
    lines.iter().filter(|l| l.visible(story)).map(|l| Line { who: l.who.clone(), text: l.text.clone() }).collect()
}

// ---------- actions ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Action {
    Continue,
    Missions,
    Settings,
    Controls,
    Quit,
    Back,
    Pick(usize),
    Start,
    BriefBack,
    Upscale(Upscaling),
    View,
    Invert,
    Sensitivity,
    Volume,
    Music,
    Fullscreen,
    Bloom,
    DebriefNext,
    DebriefRetry,
    DebriefMenu,
    Resume,
    Restart,
    Abort,
}

impl Action {
    /// left/right change the value instead of moving the focus
    fn adjustable(self) -> bool {
        matches!(self, Action::View | Action::Invert | Action::Sensitivity | Action::Volume | Action::Music | Action::Fullscreen | Action::Bloom)
    }
}

/// A focused element was activated (`dir` -1 steps a value back).
#[derive(Message, Clone, Copy, Debug)]
struct MenuEvent {
    action: Action,
    dir: i32,
}

#[derive(Component, Clone, Copy)]
struct Focusable {
    action: Action,
    order: usize,
}

#[derive(Component)]
struct Disabled;

#[derive(Component)]
struct DefaultFocus;

#[derive(Component)]
struct MenuButton {
    primary: bool,
    accent: Entity,
    label: Entity,
    look: Option<(bool, bool)>,
}

// ---------- animation components ----------

/// Panel unfolds from a bright line (web: holo-in).
#[derive(Component)]
struct HoloIn;

#[derive(Component)]
struct Spin(f32);

/// RGB-split copy of a title, flashing now and then.
#[derive(Component)]
struct Glitch {
    dx: f32,
    seed: f32,
}

/// Text decoding from random glyphs, starting `delay` seconds after the screen opened.
#[derive(Component)]
struct Decode {
    text: String,
    cps: f32,
    delay: f32,
}

/// Number counting up in the debrief.
#[derive(Component)]
struct CountUp {
    to: f32,
    kind: CountKind,
}

#[derive(Clone, Copy)]
enum CountKind {
    Int,
    Percent,
    Clock,
}

/// Scan band sweeping down a panel (or across the map when `across`).
#[derive(Component)]
struct Sweep {
    across: bool,
}

/// Hidden until the screen has been open for this long.
#[derive(Component)]
struct Reveal(f32);

// ---------- screen selection & building ----------

fn wanted_screen(state: AppState, paused: bool, nav: &MenuNav) -> Option<Screen> {
    match state {
        AppState::Menu => Some(match nav.menu {
            MenuScreen::Title => Screen::Title,
            MenuScreen::Missions => Screen::Missions,
            MenuScreen::Settings => Screen::Settings,
            MenuScreen::Controls => Screen::Controls,
        }),
        AppState::Briefing => Some(Screen::Briefing),
        AppState::Debrief => Some(Screen::Debrief),
        AppState::Flight if paused => Some(if nav.pause_settings { Screen::Settings } else { Screen::Pause }),
        AppState::Flight => None,
    }
}

#[derive(SystemParam)]
struct Ctx<'w> {
    fonts: Res<'w, UiFonts>,
    data: Res<'w, GameData>,
    progress: Res<'w, Progress>,
    settings: Res<'w, Settings>,
    dlss: Res<'w, DlssAvailable>,
    debrief: Res<'w, Debriefing>,
    camp: Res<'w, Campaign2>,
    story: Res<'w, Story>,
}

#[allow(clippy::too_many_arguments)]
fn sync_screen(
    mut commands: Commands,
    time: Res<Time>,
    state: Res<State<AppState>>,
    paused: Res<Paused>,
    mut nav: ResMut<MenuNav>,
    mut shown: ResMut<Shown>,
    mut focus: ResMut<Focus>,
    ctx: Ctx,
    cam: Query<Entity, With<MainCamera>>,
    items: Query<&Focusable>,
) {
    if !paused.0 {
        nav.pause_settings = false;
    }
    shown.age += time.delta_secs();
    let want = wanted_screen(*state.get(), paused.0, &nav);
    if want == shown.screen && !shown.dirty {
        return;
    }
    let rebuild = want == shown.screen;
    if let Some(root) = shown.root.take() {
        commands.entity(root).try_despawn();
    }
    focus.restore = if rebuild { focus.entity.and_then(|e| items.get(e).ok()).map(|f| f.order) } else { None };
    focus.entity = None;
    shown.dirty = false;
    shown.screen = want;
    let Some(screen) = want else { return };
    // the main camera is spawned at Startup; the first Menu frame may come before it
    let Ok(cam) = cam.single() else {
        shown.screen = None;
        return;
    };
    if !rebuild {
        shown.age = 0.0;
    }
    let root = commands
        .spawn((
            Node { position_type: PositionType::Absolute, width: percent(100.0), height: percent(100.0), ..default() },
            GlobalZIndex(10),
            UiTargetCamera(cam),
            Name::new("Menu"),
        ))
        .id();
    let mut b = Build { f: &ctx.fonts, order: 0, animate: !rebuild };
    commands.entity(root).with_children(|p| match screen {
        Screen::Title => title_screen(p, &mut b, &ctx),
        Screen::Missions => missions_screen(p, &mut b, &ctx),
        Screen::Settings => settings_screen(p, &mut b, &ctx, *state.get() == AppState::Flight),
        Screen::Controls => controls_screen(p, &mut b),
        Screen::Briefing => briefing_screen(p, &mut b, &ctx),
        Screen::Debrief => debrief_screen(p, &mut b, &ctx),
        Screen::Pause => pause_screen(p, &mut b, &ctx),
    });
    shown.root = Some(root);
}

/// Spawning helper: fonts, focus order counter, whether panels animate in.
struct Build<'a> {
    f: &'a UiFonts,
    order: usize,
    animate: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Normal,
    Primary,
    Disabled,
}

impl Build<'_> {
    /// A menu button: accent bar, Orbitron label, optional second line.
    fn button(&mut self, p: &mut ChildSpawnerCommands, text: &str, sub: Option<&str>, action: Action, kind: Kind) -> Entity {
        let f = self.f;
        let mut accent = Entity::PLACEHOLDER;
        let mut lbl = Entity::PLACEHOLDER;
        let mut ec = p.spawn((
            Node {
                padding: UiRect::new(px(14.0), px(24.0), px(13.0), px(13.0)),
                border: UiRect::all(px(1.0)),
                align_items: AlignItems::Center,
                column_gap: px(14.0),
                ..default()
            },
            BackgroundGradient::default(),
            BorderColor::all(LINE),
            BoxShadow::default(),
            Focusable { action, order: self.order },
        ));
        ec.with_children(|c| {
            accent = c.spawn((Node { width: px(4.0), height: px(20.0), flex_shrink: 0.0, ..default() }, BackgroundColor(DIM), Pickable::IGNORE)).id();
            c.spawn((Node { flex_direction: FlexDirection::Column, row_gap: px(3.0), ..default() }, Pickable::IGNORE)).with_children(|col| {
                lbl = col.spawn((label(&f.display, 16.0, INK, 2.5, display_safe(text)), Pickable::IGNORE)).id();
                if let Some(s) = sub {
                    let c = if kind == Kind::Primary { rgba(255, 240, 225, 0.85) } else { MUTED };
                    col.spawn((label(&f.semi, 16.0, c, 1.0, s), Pickable::IGNORE));
                }
            });
        });
        ec.insert(MenuButton { primary: kind == Kind::Primary, accent, label: lbl, look: None });
        if kind == Kind::Disabled {
            ec.insert(Disabled);
        }
        self.order += 1;
        let id = ec.id();
        observe_button(&mut ec, id);
        id
    }

    /// A settings row: label left, value (and optional level bar) right; Enter / click steps the value.
    fn value_row(&mut self, p: &mut ChildSpawnerCommands, text: &str, value: &str, level: Option<f32>, action: Action) -> Entity {
        let f = self.f;
        let mut accent = Entity::PLACEHOLDER;
        let mut lbl = Entity::PLACEHOLDER;
        let mut ec = p.spawn((
            Node {
                padding: UiRect::new(px(14.0), px(18.0), px(11.0), px(11.0)),
                border: UiRect::all(px(1.0)),
                align_items: AlignItems::Center,
                column_gap: px(14.0),
                ..default()
            },
            BackgroundGradient::default(),
            BorderColor::all(LINE),
            BoxShadow::default(),
            Focusable { action, order: self.order },
        ));
        ec.with_children(|c| {
            accent = c.spawn((Node { width: px(4.0), height: px(18.0), flex_shrink: 0.0, ..default() }, BackgroundColor(DIM), Pickable::IGNORE)).id();
            lbl = c.spawn((label(&f.bold, 20.0, INK, 0.8, text), Pickable::IGNORE, Node { flex_grow: 1.0, ..default() })).id();
            if let Some(k) = level {
                c.spawn((Node { width: px(120.0), height: px(6.0), border: UiRect::all(px(1.0)), ..default() }, BackgroundColor(rgba(8, 16, 28, 0.6)), BorderColor::all(DIM), Pickable::IGNORE))
                    .with_children(|bar| {
                        bar.spawn((Node { width: percent(k.clamp(0.0, 1.0) * 100.0), height: percent(100.0), ..default() }, BackgroundColor(CYAN), Pickable::IGNORE));
                    });
            }
            c.spawn((label(&f.display, 14.0, AMBER, 2.0, value), Pickable::IGNORE, Node { min_width: px(150.0), ..default() }, TextLayout::justify(Justify::Right)));
        });
        ec.insert(MenuButton { primary: false, accent, label: lbl, look: None });
        self.order += 1;
        let id = ec.id();
        observe_button(&mut ec, id);
        id
    }

    /// Holographic panel: corner accents, scan sweep, kicker + title header, then `body`.
    fn panel(
        &mut self,
        p: &mut ChildSpawnerCommands,
        width: f32,
        kicker: &str,
        title: &str,
        title_color: Color,
        body: impl FnOnce(&mut ChildSpawnerCommands, &mut Self),
    ) -> Entity {
        let f = self.f;
        let mut ec = p.spawn((
            Node {
                width: px(width),
                max_width: percent(96.0),
                max_height: percent(94.0),
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(px(34.0), px(26.0)),
                border: UiRect::all(px(1.0)),
                overflow: Overflow::clip(),
                ..default()
            },
            BackgroundColor(PANEL),
            BorderColor::all(LINE),
            BoxShadow::new(rgba(60, 150, 230, 0.09), px(0.0), px(0.0), px(0.0), px(40.0)),
            UiTransform::default(),
        ));
        if self.animate {
            ec.insert(HoloIn);
        }
        ec.with_children(|c| {
            c.spawn((
                Node { position_type: PositionType::Absolute, left: px(0.0), right: px(0.0), top: px(0.0), height: percent(40.0), ..default() },
                BackgroundGradient::from(LinearGradient::to_bottom(vec![
                    ColorStop::percent(rgba(127, 214, 255, 0.0), 0.0),
                    ColorStop::percent(rgba(127, 214, 255, 0.03), 80.0),
                    ColorStop::percent(rgba(170, 230, 255, 0.08), 99.0),
                    ColorStop::percent(rgba(170, 230, 255, 0.0), 100.0),
                ])),
                Sweep { across: false },
                Pickable::IGNORE,
            ));
            corner_accents(c, CYAN, 18.0, 6.0);
            c.spawn(label(&f.display, 13.0, ORANGE, 5.0, display_safe(kicker)));
            let shown = display_safe(title);
            c.spawn((
                label(&f.display, 36.0, title_color, 4.5, if self.animate { String::new() } else { shown.clone() }),
                Node { margin: UiRect::new(px(0.0), px(0.0), px(6.0), px(16.0)), ..default() },
                Decode { text: shown, cps: 30.0, delay: 0.15 },
            ));
            body(c, self);
        });
        ec.id()
    }

    fn h3(&self, p: &mut ChildSpawnerCommands, text: &str) {
        p.spawn((label(&self.f.display, 12.0, CYAN, 4.0, display_safe(text)), Node { margin: UiRect::new(px(0.0), px(0.0), px(14.0), px(6.0)), ..default() }));
    }
}

/// Moving the mouse over an element focuses it (a pointer that merely rests where a new screen opens does not),
/// click activates (right click steps back).
fn observe_button(ec: &mut EntityCommands, id: Entity) {
    ec.observe(move |_: On<PointerMove>, mut focus: ResMut<Focus>, disabled: Query<(), With<Disabled>>, mut sfx: MessageWriter<SfxMsg>| {
        if disabled.get(id).is_err() && focus.entity != Some(id) {
            focus.entity = Some(id);
            sfx.write(SfxMsg::UiMove);
        }
    });
    ec.observe(
        move |ev: On<PointerClick>, mut focus: ResMut<Focus>, items: Query<&Focusable, Without<Disabled>>, mut out: MessageWriter<MenuEvent>| {
            let dir = match ev.button {
                PointerButton::Primary => 1,
                PointerButton::Secondary => -1,
                _ => return,
            };
            if let Ok(f) = items.get(id) {
                focus.entity = Some(id);
                out.write(MenuEvent { action: f.action, dir });
            }
        },
    );
}

/// Full-screen centring container (dimmed for overlays).
fn screen_root<'a>(p: &'a mut ChildSpawnerCommands, dim: f32) -> EntityCommands<'a> {
    p.spawn((
        Node {
            width: percent(100.0),
            height: percent(100.0),
            flex_direction: FlexDirection::Column,
            align_items: AlignItems::Center,
            justify_content: JustifyContent::Center,
            ..default()
        },
        BackgroundGradient::from(RadialGradient::new(
            UiPosition::CENTER,
            RadialGradientShape::FarthestCorner,
            vec![ColorStop::percent(rgba(5, 7, 13, dim * 0.25), 0.0), ColorStop::percent(rgba(5, 7, 13, dim), 100.0)],
        )),
    ))
}

fn row(p: &mut ChildSpawnerCommands, justify: JustifyContent, body: impl FnOnce(&mut ChildSpawnerCommands)) {
    p.spawn(Node { justify_content: justify, align_items: AlignItems::Center, column_gap: px(12.0), margin: UiRect::top(px(20.0)), ..default() })
        .with_children(body);
}

fn hint(f: &UiFonts, p: &mut ChildSpawnerCommands, text: &str) {
    p.spawn((label(&f.semi, 15.0, MUTED, 1.5, text), Node { margin: UiRect::right(Val::Auto), ..default() }));
}

// ---------- title ----------

fn title_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx) {
    let f = b.f;
    let pr = &ctx.progress;
    let n = ctx.data.campaign.missions.len();
    let fresh = pr.current == 0 && pr.unlocked == 0 && pr.total_kills == 0;
    p.spawn((
        Node {
            width: percent(100.0),
            height: percent(100.0),
            flex_direction: FlexDirection::Column,
            justify_content: JustifyContent::Center,
            padding: UiRect::left(percent(7.0)),
            ..default()
        },
        BackgroundGradient::from(LinearGradient::to_right(vec![
            ColorStop::percent(rgba(5, 7, 13, 0.9), 0.0),
            ColorStop::percent(rgba(5, 7, 13, 0.5), 42.0),
            ColorStop::percent(rgba(5, 7, 13, 0.0), 70.0),
        ])),
    ))
    .with_children(|t| {
        // rotating rings behind the logo
        t.spawn((Node { position_type: PositionType::Absolute, left: px(30.0), top: px(110.0), width: px(760.0), height: px(760.0), ..default() }, Pickable::IGNORE))
            .with_children(|r| {
                for (inset, width, all, top, left, speed) in [
                    (0.0, 1.0, rgba(127, 214, 255, 0.18), rgba(127, 214, 255, 0.6), rgba(127, 214, 255, 0.18), TAU / 18.0),
                    (9.0, 1.0, rgba(127, 214, 255, 0.1), rgba(255, 138, 42, 0.5), rgba(127, 214, 255, 0.1), -TAU / 30.0),
                    (22.0, 2.0, Color::NONE, Color::NONE, rgba(127, 214, 255, 0.45), TAU / 9.0),
                ] {
                    r.spawn((
                        Node {
                            position_type: PositionType::Absolute,
                            left: percent(inset),
                            top: percent(inset),
                            right: percent(inset),
                            bottom: percent(inset),
                            border: UiRect::all(px(width)),
                            border_radius: BorderRadius::MAX,
                            ..default()
                        },
                        BorderColor { top, right: all, bottom: all, left },
                        Spin(speed),
                        Pickable::IGNORE,
                    ));
                }
            });
        t.spawn(label(&f.display, 14.0, CYAN, 8.0, "GESCHWADER NACHTFALKEN"));
        // title with RGB-split glitch copies
        t.spawn(Node { margin: UiRect::vertical(px(8.0)), ..default() }).with_children(|lg| {
            lg.spawn(label(&f.display, 96.0, WHITE, 10.0, "STERNENFRONT")).insert(TextShadow { offset: Vec2::new(3.0, 4.0), color: rgba(40, 110, 220, 0.6) });
            for (col, dx, seed) in [(rgba(255, 45, 111, 0.85), -4.0, 0.0), (rgba(41, 226, 255, 0.85), 4.0, 0.03)] {
                lg.spawn((
                    label(&f.display, 96.0, col, 10.0, "STERNENFRONT"),
                    Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), ..default() },
                    Glitch { dx, seed },
                    Visibility::Hidden,
                    UiTransform::default(),
                    Pickable::IGNORE,
                ));
            }
        });
        t.spawn(label(&f.bold, 24.0, ORANGE, 9.0, "DER PERSEUS-KRIEG"));

        t.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(10.0), width: px(470.0), margin: UiRect::top(px(46.0)), ..default() }).with_children(|m| {
            let cur = ctx.data.mission(pr.current);
            let sub = format!("Mission {} · {}", pr.current.min(n.saturating_sub(1)) + 1, cur.title);
            let e = b.button(m, if fresh { "Kampagne beginnen" } else { "Kampagne fortsetzen" }, Some(&sub), Action::Continue, Kind::Primary);
            m.commands().entity(e).insert(DefaultFocus);
            b.button(m, "Mission wählen", None, Action::Missions, Kind::Normal);
            b.button(m, "Einstellungen", None, Action::Settings, Kind::Normal);
            b.button(m, "Steuerung", None, Action::Controls, Kind::Normal);
            b.button(m, "Beenden", None, Action::Quit, Kind::Normal);
        });
        let rank = ctx.camp.rank(pr.total_kills);
        t.spawn((
            label(
                &f.bold,
                16.0,
                MUTED,
                2.5,
                format!(
                    "PILOT {} · RANG {} · ABSCHÜSSE {} · FREIGESCHALTET {}/{}",
                    pr.callsign.to_uppercase(),
                    rank.to_uppercase(),
                    pr.total_kills,
                    (pr.unlocked + 1).min(n),
                    n
                ),
            ),
            Node { margin: UiRect::top(px(22.0)), ..default() },
        ));
        // graphics badge (bottom right)
        let up = effective_upscaling(ctx.settings.upscaling, ctx.dlss.0);
        let (badge, col) = if ctx.dlss.0 {
            (format!("NVIDIA DLSS BEREIT · {}", up.label().to_uppercase()), GREEN)
        } else {
            (format!("GRAFIK: {} · DLSS NICHT VERFÜGBAR", up.label().to_uppercase()), MUTED)
        };
        t.spawn((
            Node {
                position_type: PositionType::Absolute,
                right: px(28.0),
                bottom: px(24.0),
                padding: UiRect::axes(px(14.0), px(8.0)),
                border: UiRect::all(px(1.0)),
                ..default()
            },
            BackgroundColor(rgba(6, 16, 30, 0.6)),
            BorderColor::all(LINE),
        ))
        .with_children(|bd| {
            bd.spawn(label(&f.bold, 15.0, col, 2.0, badge));
        });
    });
}

// ---------- mission select ----------

fn missions_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx) {
    let missions = &ctx.data.campaign.missions;
    let unlocked = ctx.progress.unlocked;
    let current = ctx.progress.current;
    let mut acts: Vec<&str> = Vec::new();
    for m in missions.iter() {
        if !acts.contains(&m.act.as_str()) {
            acts.push(&m.act);
        }
    }
    screen_root(p, 0.75).with_children(|s| {
        b.panel(s, 1560.0, "Einsatzarchiv", "Mission wählen", WHITE, |c, b| {
            c.spawn(Node { column_gap: px(22.0), align_items: AlignItems::FlexStart, ..default() }).with_children(|cols| {
                for act in &acts {
                    cols.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(7.0), width: px(484.0), ..default() }).with_children(|col| {
                        let name = ctx.data.campaign.acts.get(*act).cloned().unwrap_or_else(|| format!("Akt {act}"));
                        b.h3(col, &name);
                        for (i, m) in missions.iter().enumerate().filter(|(_, m)| m.act == *act) {
                            if i <= unlocked {
                                let sub = if i == current { format!("{} · aktuell", m.sector) } else { m.sector.clone() };
                                let e = b.button(col, &format!("{:02}  {}", i + 1, m.title), Some(&sub), Action::Pick(i), Kind::Normal);
                                if i == current.min(unlocked) {
                                    col.commands().entity(e).insert(DefaultFocus);
                                }
                            } else {
                                b.button(col, &format!("{:02}  Gesperrt", i + 1), None, Action::Pick(i), Kind::Disabled);
                            }
                        }
                    });
                }
            });
            row(c, JustifyContent::FlexEnd, |r| {
                hint(b.f, r, "Freigeschaltet: abgeschlossene Missionen und die nächste");
                b.button(r, "Zurück", None, Action::Back, Kind::Normal);
            });
        });
    });
}

// ---------- settings ----------

fn settings_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx, in_flight: bool) {
    let s = &ctx.settings;
    let dlss = ctx.dlss.0;
    let onoff = |v: bool| if v { "EIN" } else { "AUS" };
    let mut root = screen_root(p, 0.75);
    if in_flight {
        // over the running mission: dim evenly so the HUD does not show through the panel
        root.insert(BackgroundColor(rgba(3, 6, 12, 0.7)));
    }
    root.with_children(|root| {
        b.panel(root, 1240.0, "System", "Einstellungen", WHITE, |c, b| {
            c.spawn(Node { column_gap: px(36.0), align_items: AlignItems::FlexStart, ..default() }).with_children(|cols| {
                // graphics: anti-aliasing / upscaling choice
                cols.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(6.0), width: px(560.0), ..default() }).with_children(|g| {
                    b.h3(g, "Grafik · Kantenglättung und Upscaling");
                    let active = effective_upscaling(s.upscaling, dlss);
                    for u in Upscaling::ALL {
                        let off = u.is_dlss() && !dlss;
                        let sel = active == u;
                        let e = radio_row(b, g, u.label(), sel, off, Action::Upscale(u));
                        if sel {
                            g.commands().entity(e).insert(DefaultFocus);
                        }
                    }
                    let (note, col) = if dlss {
                        ("NVIDIA DLSS ist verfügbar: Upscaling mit KI-Rekonstruktion.", GREEN)
                    } else {
                        ("DLSS benötigt eine NVIDIA-RTX-Grafikkarte – ohne sie läuft das Spiel mit TAA.", AMBER)
                    };
                    g.spawn((label(&b.f.semi, 17.0, col, 0.5, note), Node { margin: UiRect::top(px(6.0)), ..default() }));
                });
                cols.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(6.0), width: px(560.0), ..default() }).with_children(|o| {
                    b.h3(o, "Bild");
                    b.value_row(o, "Bloom (Leuchten)", onoff(s.bloom), None, Action::Bloom);
                    b.value_row(o, "Vollbild", onoff(s.fullscreen), None, Action::Fullscreen);
                    b.value_row(o, "Ansicht", if s.view == View::Cockpit { "COCKPIT" } else { "AUSSEN" }, None, Action::View);
                    b.h3(o, "Steuerung");
                    b.value_row(o, "Höhenruder invertieren", onoff(s.invert), None, Action::Invert);
                    let sens = format!("{:.1}", s.sensitivity).replace('.', ",");
                    b.value_row(o, "Empfindlichkeit", &sens, Some((s.sensitivity - 0.3) / 1.7), Action::Sensitivity);
                    b.h3(o, "Ton");
                    b.value_row(o, "Lautstärke", &format!("{} %", (s.master_volume * 100.0).round() as i32), Some(s.master_volume), Action::Volume);
                    b.value_row(o, "Musik", onoff(s.music), None, Action::Music);
                });
            });
            row(c, JustifyContent::FlexEnd, |r| {
                hint(b.f, r, "Pfeiltasten / Steuerkreuz: wählen und ändern · Rechtsklick: Wert zurück");
                b.button(r, "Zurück", None, Action::Back, Kind::Primary);
            });
        });
    });
}

/// Without an RTX card a DLSS choice runs as TAA (render.rs falls back the same way).
fn effective_upscaling(u: Upscaling, dlss: bool) -> Upscaling {
    if u.is_dlss() && !dlss { Upscaling::Taa } else { u }
}

/// Radio option (upscaling mode): square indicator, label; greyed out when unavailable.
fn radio_row(b: &mut Build, p: &mut ChildSpawnerCommands, text: &str, selected: bool, disabled: bool, action: Action) -> Entity {
    let f = b.f;
    let mut accent = Entity::PLACEHOLDER;
    let mut lbl = Entity::PLACEHOLDER;
    let mut ec = p.spawn((
        Node {
            padding: UiRect::new(px(14.0), px(18.0), px(9.0), px(9.0)),
            border: UiRect::all(px(1.0)),
            align_items: AlignItems::Center,
            column_gap: px(14.0),
            ..default()
        },
        BackgroundGradient::default(),
        BorderColor::all(LINE),
        BoxShadow::default(),
        Focusable { action, order: b.order },
    ));
    ec.with_children(|c| {
        accent = c.spawn((Node { width: px(4.0), height: px(18.0), flex_shrink: 0.0, ..default() }, BackgroundColor(DIM), Pickable::IGNORE)).id();
        c.spawn((
            Node { width: px(14.0), height: px(14.0), border: UiRect::all(px(2.0)), align_items: AlignItems::Center, justify_content: JustifyContent::Center, ..default() },
            BorderColor::all(if disabled { rgba(159, 180, 200, 0.3) } else { CYAN }),
            Pickable::IGNORE,
        ))
        .with_children(|ind| {
            if selected {
                ind.spawn((Node { width: px(6.0), height: px(6.0), ..default() }, BackgroundColor(AMBER), Pickable::IGNORE));
            }
        });
        lbl = c.spawn((label(&f.bold, 19.0, INK, 0.8, text), Pickable::IGNORE)).id();
        if selected {
            c.spawn((label(&f.display, 11.0, AMBER, 2.5, "AKTIV"), Node { margin: UiRect::left(Val::Auto), ..default() }, Pickable::IGNORE));
        }
    });
    ec.insert(MenuButton { primary: false, accent, label: lbl, look: None });
    if disabled {
        ec.insert(Disabled);
    }
    b.order += 1;
    let id = ec.id();
    observe_button(&mut ec, id);
    id
}

// ---------- controls ----------

fn controls_screen(p: &mut ChildSpawnerCommands, b: &mut Build) {
    const KEYS: [(&str, &str); 11] = [
        ("W S A D / PFEILE", "Steuern (Nase hoch/runter, links/rechts)"),
        ("MAUS", "Steuern wie ein Steuerknüppel, der zur Mitte zurückfedert"),
        ("LEERTASTE / LMT", "Pulslaser"),
        ("M / ENTER / RMT", "Neutronenkanone (mit Zielaufschaltung gelenkt)"),
        ("SHIFT", "Boost · gehalten ohne Feinde: Impulsantrieb"),
        ("Q / E · MAUSRAD", "Schub"),
        ("T", "Ziel wechseln"),
        ("J", "Autopilot zum nächsten Navpunkt"),
        ("V / C", "Cockpit / Außenansicht"),
        ("ESC / P", "Pause"),
        ("", ""),
    ];
    const PAD: [(&str, &str); 9] = [
        ("LINKER STICK", "Steuern"),
        ("RT", "Pulslaser"),
        ("LT", "Boost · gehalten ohne Feinde: Impulsantrieb"),
        ("A / X", "Neutronenkanone"),
        ("Y", "Ziel wechseln"),
        ("B", "Cockpit / Außenansicht"),
        ("RECHTER STICK / KREUZ", "Schub"),
        ("SELECT", "Autopilot"),
        ("START", "Pause"),
    ];
    let f = b.f;
    screen_root(p, 0.75).with_children(|s| {
        b.panel(s, 1400.0, "Handbuch", "Steuerung", WHITE, |c, b| {
            c.spawn(Node { column_gap: px(48.0), ..default() }).with_children(|cols| {
                for (head, list) in [("Tastatur und Maus", &KEYS[..10]), ("Gamepad", &PAD[..])] {
                    cols.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(9.0), width: px(640.0), ..default() }).with_children(|col| {
                        b.h3(col, head);
                        for (k, d) in list {
                            col.spawn(Node { column_gap: px(16.0), align_items: AlignItems::Center, ..default() }).with_children(|r| {
                                r.spawn((label(&f.display, 13.0, AMBER, 1.5, display_safe(k)), Node { width: px(230.0), flex_shrink: 0.0, ..default() }));
                                r.spawn(label(&f.semi, 19.0, INK, 0.3, *d));
                            });
                        }
                    });
                }
            });
            c.spawn((
                label(&f.semi, 18.0, AMBER, 0.3, "Tipp: Der Kreis vor dem Ziel ist der Vorhaltepunkt. Wird das Fadenkreuz grün, treffen deine Schüsse automatisch."),
                Node { margin: UiRect::top(px(18.0)), ..default() },
            ));
            row(c, JustifyContent::FlexEnd, |r| {
                let e = b.button(r, "Verstanden", None, Action::Back, Kind::Primary);
                r.commands().entity(e).insert(DefaultFocus);
            });
        });
    });
}

// ---------- briefing ----------

fn briefing_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx) {
    let data = &ctx.data;
    let idx = ctx.progress.current.min(data.campaign.missions.len().saturating_sub(1));
    let m = data.mission(idx);
    let act = data.campaign.acts.get(&m.act).cloned().unwrap_or_default();
    let kicker = format!("{act} • Mission {} / {} • {}", idx + 1, data.campaign.missions.len(), m.sector);
    let f = b.f;
    let cs = ctx.progress.callsign.clone();
    screen_root(p, 0.7).with_children(|s| {
        b.panel(s, 1600.0, &kicker, &m.title, WHITE, |c, b| {
            c.spawn(Node { column_gap: px(40.0), align_items: AlignItems::FlexStart, ..default() }).with_children(|cols| {
                // the briefing itself: speaker + line, revealed one after another
                cols.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(14.0), flex_grow: 1.0, flex_basis: px(0.0), ..default() }).with_children(|l| {
                    b.h3(l, "Einsatzbesprechung");
                    let mut at = 0.35;
                    // conditional lines (if / ifNot / aff) are filtered against the saved story state
                    let lines = ctx.camp.texts(idx).map(|t| visible_lines(&t.briefing, &ctx.story.0)).unwrap_or_else(|| m.briefing.clone());
                    for line in &lines {
                        let text = fill_callsign(&line.text, &cs);
                        l.spawn((Node { flex_direction: FlexDirection::Column, row_gap: px(3.0), ..default() }, Reveal(at), Visibility::Hidden)).with_children(|blk| {
                            blk.spawn(label(&f.display, 12.0, char_color(data, &line.who), 2.5, display_safe(&data.speaker(&line.who))));
                            blk.spawn((label(&f.semi, 21.0, rgba(240, 248, 255, 1.0), 0.2, ""), Decode { text: text.clone(), cps: 140.0, delay: at }));
                        });
                        at += 0.25 + text.chars().count() as f32 / 140.0;
                    }
                });
                // map, objectives, ship, wingman
                cols.spawn(Node { flex_direction: FlexDirection::Column, width: px(620.0), flex_shrink: 0.0, ..default() }).with_children(|r| {
                    b.h3(r, "Einsatzgebiet");
                    nav_map(r, f, m);
                    b.h3(r, "Missionsziele");
                    for o in &m.objectives {
                        r.spawn(Node { column_gap: px(10.0), align_items: AlignItems::Center, margin: UiRect::bottom(px(4.0)), ..default() }).with_children(|li| {
                            li.spawn((Node { width: px(7.0), height: px(7.0), flex_shrink: 0.0, ..default() }, BackgroundColor(AMBER), UiTransform::from_rotation(Rot2::degrees(45.0))));
                            li.spawn(label(&f.semi, 19.0, INK, 0.2, o.as_str()));
                        });
                    }
                    b.h3(r, "Zugeteilter Jäger");
                    let sd = data.ship(&m.ship);
                    r.spawn(label(
                        &f.semi,
                        19.0,
                        INK,
                        0.2,
                        format!(
                            "{} – {} Pulslaser · Neutronenkanone mit {} Schuss · Schild {} · Hülle {}",
                            sd.name,
                            sd.guns.len(),
                            sd.missiles,
                            sd.shield.round(),
                            sd.hp.round()
                        ),
                    ));
                    b.h3(r, "Flügel");
                    let wing = wing_for(m, |k| ctx.story.0.flags.contains(k)).map(|w| data.speaker(&w)).unwrap_or_else(|| "Keiner".into());
                    r.spawn(label(&f.semi, 19.0, INK, 0.2, wing));
                });
            });
            row(c, JustifyContent::FlexEnd, |r| {
                hint(f, r, "Enter / A: Start · Esc / B: Hauptmenü");
                b.button(r, "Hauptmenü", None, Action::BriefBack, Kind::Normal);
                let e = b.button(r, "Start", None, Action::Start, Kind::Primary);
                r.commands().entity(e).insert(DefaultFocus);
            });
        });
    });
}

/// Top-down sector map: carrier (green square), nav points (amber diamonds), the route between them.
fn nav_map(p: &mut ChildSpawnerCommands, f: &UiFonts, m: &Mission) {
    const W: f32 = 620.0;
    const H: f32 = 300.0;
    let mut pts: Vec<(Vec2, String, bool)> = vec![(Vec2::ZERO, "TUS Aurora".into(), true)];
    pts.extend(m.navs.iter().map(|n| (Vec2::new(n.pos[0], n.pos[2]), n.name.clone(), false)));
    let (mut lo, mut hi) = (Vec2::splat(f32::MAX), Vec2::splat(f32::MIN));
    for (q, ..) in &pts {
        lo = lo.min(*q);
        hi = hi.max(*q);
    }
    lo -= Vec2::splat(1500.0);
    hi += Vec2::splat(1500.0);
    let sc = ((W - 90.0) / (hi.x - lo.x)).min((H - 90.0) / (hi.y - lo.y));
    let mid = (lo + hi) * 0.5;
    // world x grows to the left on the map (looking down with +Z up the screen, as the web map)
    let map = |q: Vec2| Vec2::new(W * 0.5 - (q.x - mid.x) * sc, H * 0.5 - (q.y - mid.y) * sc);
    p.spawn((
        Node { width: px(W), height: px(H), border: UiRect::all(px(1.0)), overflow: Overflow::clip(), ..default() },
        BackgroundColor(rgba(4, 10, 18, 0.7)),
        BorderColor::all(LINE),
    ))
    .with_children(|mp| {
        // grid
        for i in 1..(W / 40.0) as i32 {
            mp.spawn((Node { position_type: PositionType::Absolute, left: px(i as f32 * 40.0), top: px(0.0), width: px(1.0), height: percent(100.0), ..default() }, BackgroundColor(rgba(127, 214, 255, 0.07))));
        }
        for i in 1..(H / 40.0) as i32 {
            mp.spawn((Node { position_type: PositionType::Absolute, top: px(i as f32 * 40.0), left: px(0.0), height: px(1.0), width: percent(100.0), ..default() }, BackgroundColor(rgba(127, 214, 255, 0.07))));
        }
        // route (closing back to the carrier), revealed segment by segment
        let n = pts.len();
        for i in 0..n {
            let (a, c) = (map(pts[i].0), map(pts[(i + 1) % n].0));
            let d = c - a;
            let len = d.length();
            if len < 1.0 {
                continue;
            }
            let midp = (a + c) * 0.5;
            mp.spawn((
                abs_node(len, 2.0),
                BackgroundColor(rgba(255, 200, 87, if i + 1 == n { 0.35 } else { 0.75 })),
                UiTransform { translation: Val2::px(midp.x - len * 0.5, midp.y - 1.0), rotation: Rot2::radians(d.y.atan2(d.x)), ..default() },
                Reveal(0.3 + i as f32 * 0.22),
                Visibility::Hidden,
            ));
        }
        for (i, (q, name, home)) in pts.iter().enumerate() {
            let s = map(*q);
            let col = if *home { GREEN } else { AMBER };
            let at = 0.2 + i as f32 * 0.22;
            mp.spawn((
                abs_node(14.0, 14.0),
                BackgroundColor(col),
                UiTransform { translation: Val2::px(s.x - 7.0, s.y - 7.0), rotation: Rot2::degrees(if *home { 0.0 } else { 45.0 }), ..default() },
                Reveal(at),
                Visibility::Hidden,
            ));
            let mut ring = abs_node(34.0, 34.0);
            ring.border = UiRect::all(px(1.0));
            ring.border_radius = BorderRadius::MAX;
            mp.spawn((ring, BorderColor::all(with_a(col, 0.6)), UiTransform::from_translation(Val2::px(s.x - 17.0, s.y - 17.0)), Reveal(at), Visibility::Hidden));
            mp.spawn((
                Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), width: px(220.0), justify_content: JustifyContent::Center, ..default() },
                UiTransform::from_translation(Val2::px(s.x - 110.0, s.y - 42.0)),
                Reveal(at),
                Visibility::Hidden,
            ))
            .with_children(|t| {
                t.spawn((label(&f.bold, 15.0, INK, 1.5, name.to_uppercase()), TextLayout::justify(Justify::Center)));
            });
        }
        // scan line sweeping across
        mp.spawn((
            Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), width: px(60.0), height: percent(100.0), ..default() },
            BackgroundGradient::from(LinearGradient::to_right(vec![ColorStop::auto(rgba(127, 214, 255, 0.0)), ColorStop::auto(rgba(127, 214, 255, 0.16))])),
            Sweep { across: true },
            Pickable::IGNORE,
        ));
    });
}

fn with_a(c: Color, a: f32) -> Color {
    c.with_alpha(a)
}

// ---------- debrief ----------

fn debrief_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx) {
    let d = &ctx.debrief;
    let data = &ctx.data;
    let m = data.mission(d.mission);
    let f = b.f;
    let (title, col) = match d.outcome {
        Outcome::Win => ("Mission erfolgreich".to_string(), GREEN),
        Outcome::Branch => (if d.title.is_empty() { "Mission verloren".to_string() } else { d.title.clone() }, AMBER),
        Outcome::Lose => ("Mission gescheitert".to_string(), RED),
    };
    let acc = if d.stats.shots > 0 { (d.stats.hits as f32 / d.stats.shots as f32).min(1.0) * 100.0 } else { 0.0 };
    let cs = ctx.progress.callsign.clone();
    screen_root(p, 0.75).with_children(|s| {
        b.panel(s, 1100.0, &format!("Nachbesprechung · {}", m.title), &title, col, |c, b| {
            if !d.reason.is_empty() {
                c.spawn(label(&f.semi, 21.0, INK, 0.3, d.reason.as_str()));
            }
            c.spawn(Node {
                display: Display::Grid,
                grid_template_columns: RepeatedGridTrack::flex(4, 1.0),
                column_gap: px(12.0),
                margin: UiRect::top(px(16.0)),
                ..default()
            })
            .with_children(|g| {
                let stats = [
                    ("Abschüsse", d.stats.kills as f32, CountKind::Int),
                    ("Trefferquote", acc.round(), CountKind::Percent),
                    ("Einsatzzeit", d.stats.time.floor(), CountKind::Clock),
                    ("Punkte", d.stats.score as f32, CountKind::Int),
                ];
                for (name, v, kind) in stats {
                    g.spawn((
                        Node { flex_direction: FlexDirection::Column, align_items: AlignItems::Center, padding: UiRect::all(px(12.0)), border: UiRect::all(px(1.0)), row_gap: px(4.0), ..default() },
                        BackgroundColor(rgba(4, 10, 18, 0.5)),
                        BorderColor::all(LINE),
                    ))
                    .with_children(|bx| {
                        bx.spawn((label(&f.display, 34.0, WHITE, 1.5, "0"), CountUp { to: v, kind }));
                        bx.spawn(label(&f.display, 11.0, CYAN, 3.0, display_safe(name)));
                    });
                }
            });
            if d.outcome != Outcome::Lose {
                // web debrief(): "… Die Geschichte geht weiter. · Gesamtabschüsse: n · Rang: r"
                let mut extra = String::new();
                if d.outcome == Outcome::Branch {
                    extra.push_str("Die Geschichte geht weiter. · ");
                }
                extra.push_str(&format!("Gesamtabschüsse: {} · Rang: {}", d.total_kills, d.rank));
                if d.promoted {
                    extra.push_str(&format!(" · BEFÖRDERUNG zum {}!", d.rank));
                } else if d.stats.kills >= 8 && acc >= 30.0 {
                    extra.push_str(" · Belobigung: Bronzener Falke.");
                }
                if d.next.is_none() && d.outcome == Outcome::Win {
                    extra.push_str(" · Die Kampagne ist abgeschlossen.");
                }
                c.spawn((label(&f.bold, 19.0, AMBER, 0.5, extra), Node { margin: UiRect::top(px(14.0)), ..default() }));
            }
            if !d.lines.is_empty() {
                b.h3(c, "Funkverkehr");
                for (i, line) in d.lines.iter().enumerate() {
                    let at = 0.6 + i as f32 * 0.5;
                    c.spawn((Node { flex_direction: FlexDirection::Column, row_gap: px(2.0), margin: UiRect::bottom(px(8.0)), ..default() }, Reveal(at), Visibility::Hidden))
                        .with_children(|r| {
                            r.spawn(label(&f.display, 11.0, char_color(data, &line.who), 2.0, display_safe(&data.speaker(&line.who))));
                            r.spawn(label(&f.semi, 19.0, INK, 0.2, fill_callsign(&line.text, &cs)));
                        });
                }
            }
            row(c, JustifyContent::FlexEnd, |r| {
                b.button(r, "Hauptmenü", None, Action::DebriefMenu, Kind::Normal);
                let main = match (d.outcome, d.next) {
                    (Outcome::Lose, _) => b.button(r, "Erneut versuchen", None, Action::DebriefRetry, Kind::Primary),
                    (_, Some(_)) => {
                        b.button(r, "Wiederholen", None, Action::DebriefRetry, Kind::Normal);
                        b.button(r, "Nächste Mission", None, Action::DebriefNext, Kind::Primary)
                    }
                    (_, None) => b.button(r, "Wiederholen", None, Action::DebriefRetry, Kind::Primary),
                };
                r.commands().entity(main).insert(DefaultFocus);
            });
        });
    });
}

// ---------- pause ----------

fn pause_screen(p: &mut ChildSpawnerCommands, b: &mut Build, ctx: &Ctx) {
    let m = ctx.data.mission(ctx.progress.current);
    screen_root(p, 0.8).insert(BackgroundColor(rgba(3, 6, 12, 0.55))).with_children(|s| {
        b.panel(s, 560.0, "Einsatz angehalten", "Pause", WHITE, |c, b| {
            c.spawn((label(&b.f.semi, 19.0, MUTED, 1.0, format!("{} · {}", m.title, m.sector)), Node { margin: UiRect::bottom(px(14.0)), ..default() }));
            c.spawn(Node { flex_direction: FlexDirection::Column, row_gap: px(10.0), ..default() }).with_children(|col| {
                let e = b.button(col, "Weiterfliegen", None, Action::Resume, Kind::Primary);
                col.commands().entity(e).insert(DefaultFocus);
                b.button(col, "Mission neu starten", None, Action::Restart, Kind::Normal);
                b.button(col, "Einstellungen", None, Action::Settings, Kind::Normal);
                b.button(col, "Mission abbrechen", None, Action::Abort, Kind::Normal);
            });
            c.spawn((label(&b.f.semi, 15.0, MUTED, 1.5, "Esc / Start: weiterfliegen"), Node { margin: UiRect::top(px(14.0)), ..default() }));
        });
    });
}

// ---------- input ----------

/// Keyboard and gamepad navigation: spatial focus moves, activate, back, value steps.
#[allow(clippy::too_many_arguments)]
fn menu_input(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    pads: Query<&Gamepad>,
    shown: Res<Shown>,
    nav: Res<MenuNav>,
    mut focus: ResMut<Focus>,
    items: Query<(Entity, &Focusable, &UiGlobalTransform, Has<Disabled>, Has<DefaultFocus>)>,
    mut out: MessageWriter<MenuEvent>,
    mut sfx: MessageWriter<SfxMsg>,
    mut stick: Local<(IVec2, f32)>,
) {
    let Some(screen) = shown.screen else { return };
    let usable = |e: Entity| items.get(e).is_ok_and(|(.., dis, _)| !dis);
    // initial focus: restored order, the default element, or the first one
    if !focus.entity.is_some_and(usable) {
        let mut list: Vec<_> = items.iter().filter(|(.., dis, _)| !dis).collect();
        list.sort_by_key(|(_, f, ..)| f.order);
        let pick = focus
            .restore
            .and_then(|o| list.iter().find(|(_, f, ..)| f.order == o))
            .or_else(|| list.iter().find(|(.., d)| *d))
            .or_else(|| list.first());
        focus.entity = pick.map(|(e, ..)| *e);
        if focus.entity.is_some() {
            focus.restore = None;
        }
    }
    let Some(cur) = focus.entity else { return };

    // directions: keys, d-pad, left stick with auto-repeat
    let pad = |b: GamepadButton| pads.iter().any(|p| p.just_pressed(b));
    let mut dir = IVec2::ZERO;
    if keys.any_just_pressed([KeyCode::ArrowUp, KeyCode::KeyW]) || pad(GamepadButton::DPadUp) {
        dir.y = -1;
    }
    if keys.any_just_pressed([KeyCode::ArrowDown, KeyCode::KeyS]) || pad(GamepadButton::DPadDown) {
        dir.y = 1;
    }
    if keys.any_just_pressed([KeyCode::ArrowLeft, KeyCode::KeyA]) || pad(GamepadButton::DPadLeft) {
        dir.x = -1;
    }
    if keys.any_just_pressed([KeyCode::ArrowRight, KeyCode::KeyD]) || pad(GamepadButton::DPadRight) {
        dir.x = 1;
    }
    let s = pads.iter().map(|p| p.left_stick()).fold(Vec2::ZERO, |a, b| if b.length() > a.length() { b } else { a });
    let sdir = if s.length() < 0.6 {
        IVec2::ZERO
    } else if s.x.abs() > s.y.abs() {
        IVec2::new(s.x.signum() as i32, 0)
    } else {
        IVec2::new(0, -s.y.signum() as i32)
    };
    if sdir != stick.0 {
        stick.0 = sdir;
        stick.1 = 0.4;
        if sdir != IVec2::ZERO {
            dir = sdir;
        }
    } else if sdir != IVec2::ZERO {
        stick.1 -= time.delta_secs();
        if stick.1 <= 0.0 {
            stick.1 = 0.13;
            dir = sdir;
        }
    }

    let Ok((_, cf, ctf, ..)) = items.get(cur) else { return };
    if dir.x != 0 && cf.action.adjustable() {
        out.write(MenuEvent { action: cf.action, dir: dir.x });
    } else if dir != IVec2::ZERO {
        let d = dir.as_vec2();
        let c = ctf.translation;
        let mut best: Option<(f32, Entity)> = None;
        let mut wrap: Option<(f32, Entity)> = None;
        for (e, _, tf, dis, _) in &items {
            if e == cur || dis {
                continue;
            }
            let delta = tf.translation - c;
            let along = delta.dot(d);
            let perp = (delta - d * along).length();
            if along > 1.0 {
                let score = along + perp * 2.0;
                if best.is_none_or(|(b, _)| score < b) {
                    best = Some((score, e));
                }
            } else {
                // wrap around to the far end of a list
                let score = along - perp * 3.0;
                if wrap.is_none_or(|(b, _)| score < b) {
                    wrap = Some((score, e));
                }
            }
        }
        if let Some((_, e)) = best.or(if dir.y != 0 { wrap } else { None }) {
            focus.entity = Some(e);
            sfx.write(SfxMsg::UiMove);
        }
    }

    if keys.any_just_pressed([KeyCode::Enter, KeyCode::NumpadEnter, KeyCode::Space]) || pad(GamepadButton::South) {
        out.write(MenuEvent { action: cf.action, dir: 1 });
    }
    // back: Esc in the pause screen and its settings belongs to flight.rs (it toggles the pause; see
    // `pause_settings_back`); Backspace and pad B step back everywhere
    let esc = keys.just_pressed(KeyCode::Escape) && screen != Screen::Pause && !(screen == Screen::Settings && nav.pause_settings);
    let back = pad(GamepadButton::East) || keys.just_pressed(KeyCode::Backspace) && screen != Screen::Pause || esc;
    if back {
        let action = match screen {
            Screen::Title => None,
            Screen::Missions | Screen::Settings | Screen::Controls => Some(Action::Back),
            Screen::Briefing => Some(Action::BriefBack),
            Screen::Debrief => Some(Action::DebriefMenu),
            Screen::Pause => Some(Action::Resume),
        };
        if let Some(action) = action {
            out.write(MenuEvent { action, dir: 1 });
        }
    }
}

/// What the menu actions do.
#[allow(clippy::too_many_arguments)]
fn menu_actions(
    mut events: MessageReader<MenuEvent>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    mut paused: ResMut<Paused>,
    mut nav: ResMut<MenuNav>,
    mut shown: ResMut<Shown>,
    mut progress: ResMut<Progress>,
    mut settings: ResMut<Settings>,
    dlss: Res<DlssAvailable>,
    debrief: Res<Debriefing>,
    mut restart: ResMut<RestartPending>,
    mut sfx: MessageWriter<SfxMsg>,
    mut exit: MessageWriter<AppExit>,
) {
    for ev in events.read() {
        let in_flight = *state.get() == AppState::Flight;
        let mut changed = false;
        match ev.action {
            Action::Continue => next.set(AppState::Briefing),
            Action::Missions => nav.menu = MenuScreen::Missions,
            Action::Settings if in_flight => nav.pause_settings = true,
            Action::Settings => nav.menu = MenuScreen::Settings,
            Action::Controls => nav.menu = MenuScreen::Controls,
            Action::Quit => {
                exit.write(AppExit::Success);
            }
            Action::Back if in_flight => nav.pause_settings = false,
            Action::Back => nav.menu = MenuScreen::Title,
            Action::Pick(i) => {
                progress.current = i;
                save_json("progress.json", &*progress);
                next.set(AppState::Briefing);
            }
            Action::Start => next.set(AppState::Flight),
            Action::BriefBack | Action::DebriefMenu => {
                nav.menu = MenuScreen::Title;
                next.set(AppState::Menu);
            }
            Action::Upscale(u) => {
                if !(u.is_dlss() && !dlss.0) && settings.upscaling != u {
                    settings.upscaling = u;
                    changed = true;
                }
            }
            Action::View => {
                settings.view = if settings.view == View::Cockpit { View::Chase } else { View::Cockpit };
                changed = true;
            }
            Action::Invert => {
                settings.invert = !settings.invert;
                changed = true;
            }
            Action::Music => {
                settings.music = !settings.music;
                changed = true;
            }
            Action::Fullscreen => {
                settings.fullscreen = !settings.fullscreen;
                changed = true;
            }
            Action::Bloom => {
                settings.bloom = !settings.bloom;
                changed = true;
            }
            Action::Sensitivity => {
                settings.sensitivity = ((settings.sensitivity + 0.1 * ev.dir as f32) * 10.0).round().clamp(3.0, 20.0) / 10.0;
                changed = true;
            }
            Action::Volume => {
                settings.master_volume = ((settings.master_volume + 0.1 * ev.dir as f32) * 10.0).round().clamp(0.0, 10.0) / 10.0;
                changed = true;
            }
            Action::DebriefNext => {
                if let Some(n) = debrief.next {
                    progress.current = n;
                    save_json("progress.json", &*progress);
                }
                next.set(AppState::Briefing);
            }
            Action::DebriefRetry => {
                progress.current = debrief.mission;
                next.set(AppState::Briefing);
            }
            Action::Resume => paused.0 = false,
            Action::Restart => {
                paused.0 = false;
                restart.0 = true;
                next.set(AppState::Briefing);
            }
            Action::Abort => {
                paused.0 = false;
                nav.menu = MenuScreen::Title;
                next.set(AppState::Menu);
            }
        }
        if changed {
            save_json("settings.json", &*settings);
            shown.dirty = true;
        }
        sfx.write(SfxMsg::UiOk);
    }
}

/// Paused "Mission neu starten": the briefing passes straight through to a fresh mission.
fn restart_flight(mut restart: ResMut<RestartPending>, mut next: ResMut<NextState<AppState>>) {
    if restart.0 {
        restart.0 = false;
        next.set(AppState::Flight);
    }
}

fn apply_window_mode(settings: Res<Settings>, mut windows: Query<&mut Window, With<PrimaryWindow>>) {
    for mut w in &mut windows {
        let full = !matches!(w.mode, WindowMode::Windowed);
        if full != settings.fullscreen {
            w.mode = if settings.fullscreen { WindowMode::BorderlessFullscreen(MonitorSelection::Primary) } else { WindowMode::Windowed };
        }
    }
}

// ---------- looks & animation ----------

fn button_looks(
    focus: Res<Focus>,
    mut buttons: Query<(Entity, &mut MenuButton, Has<Disabled>, &mut BackgroundGradient, &mut BorderColor, &mut BoxShadow)>,
    mut bg: Query<&mut BackgroundColor>,
    mut tc: Query<&mut TextColor>,
) {
    for (e, mut mb, disabled, mut grad, mut border, mut shadow) in &mut buttons {
        let look = (focus.entity == Some(e), disabled);
        if mb.look == Some(look) {
            continue;
        }
        mb.look = Some(look);
        let (focused, disabled) = look;
        let (a, b, bc, text, accent, glow) = match (mb.primary, focused, disabled) {
            (_, _, true) => (rgba(16, 26, 38, 0.55), rgba(10, 16, 26, 0.35), rgba(127, 214, 255, 0.12), rgba(159, 180, 200, 0.45), Color::NONE, None),
            (true, true, _) => (rgba(255, 162, 79, 1.0), rgba(224, 102, 28, 0.95), WHITE, WHITE, WHITE, Some(rgba(255, 150, 60, 0.55))),
            (true, false, _) => (rgba(255, 138, 42, 0.92), rgba(200, 80, 20, 0.75), rgba(255, 190, 120, 0.7), WHITE, rgba(255, 255, 255, 0.5), None),
            (false, true, _) => (rgba(50, 110, 160, 0.95), rgba(20, 50, 80, 0.7), WHITE, WHITE, AMBER, Some(rgba(127, 214, 255, 0.5))),
            (false, false, _) => (rgba(20, 44, 70, 0.85), rgba(12, 24, 40, 0.55), LINE, rgba(223, 244, 255, 1.0), DIM, None),
        };
        grad.0 = vec![LinearGradient::to_right(vec![ColorStop::auto(a), ColorStop::auto(b)]).into()];
        *border = BorderColor::all(bc);
        shadow.0 = glow.map(|c| vec![ShadowStyle { color: c, x_offset: px(0.0), y_offset: px(0.0), spread_radius: px(0.0), blur_radius: px(18.0) }]).unwrap_or_default();
        if let Ok(mut t) = tc.get_mut(mb.label) {
            t.0 = text;
        }
        if let Ok(mut c) = bg.get_mut(mb.accent) {
            c.0 = accent;
        }
    }
}

#[allow(clippy::type_complexity, clippy::too_many_arguments)]
fn animate(
    time: Res<Time>,
    shown: Res<Shown>,
    mut holo: Query<&mut UiTransform, (With<HoloIn>, Without<Spin>, Without<Glitch>, Without<Sweep>)>,
    mut spin: Query<(&Spin, &mut UiTransform), (Without<HoloIn>, Without<Glitch>, Without<Sweep>)>,
    mut glitch: Query<(&Glitch, &mut UiTransform, &mut Visibility), (Without<HoloIn>, Without<Spin>, Without<Sweep>, Without<Reveal>)>,
    mut sweep: Query<(&Sweep, &mut UiTransform), (Without<HoloIn>, Without<Spin>, Without<Glitch>)>,
    mut decode: Query<(&Decode, &mut Text)>,
    mut count: Query<(&CountUp, &mut Text), Without<Decode>>,
    mut reveal: Query<(&Reveal, &mut Visibility), Without<Glitch>>,
    mut buf: Local<String>,
) {
    let age = shown.age;
    let t = time.elapsed_secs();
    // holo-in: a bright line that unfolds vertically
    let k = ((age - 0.06) / 0.22).clamp(0.0, 1.0);
    let k = 1.0 - (1.0 - k).powi(3);
    for mut tf in &mut holo {
        let want = Vec2::new(1.04 - 0.04 * k, 0.02 + 0.98 * k);
        if tf.scale != want {
            tf.scale = want;
        }
    }
    for (s, mut tf) in &mut spin {
        tf.rotation = Rot2::radians((t * s.0) % TAU);
    }
    // glitch copies: a burst when the screen opens, then a short flicker every few seconds
    for (g, mut tf, mut vis) in &mut glitch {
        let cycle = (t / 5.0 + g.seed).fract();
        let on = age < 1.0 && (age * 13.0).sin() > 0.2 || cycle > 0.93 && ((cycle * 400.0) as i32) % 2 == 0;
        let want = if on { Visibility::Inherited } else { Visibility::Hidden };
        if *vis != want {
            *vis = want;
        }
        if on {
            let j = ((t * 37.0).sin() * 0.5 + 1.0) * g.dx;
            tf.translation = Val2::px(j, 0.0);
        }
    }
    // scan bands sweep down (panels) or across (map) every 5 s
    let p = (t / 5.0).fract();
    for (s, mut tf) in &mut sweep {
        tf.translation = if s.across { Val2::percent(-100.0 + 1130.0 * p, 0.0) } else { Val2::percent(0.0, -100.0 + 360.0 * p) };
    }
    for (d, mut text) in &mut decode {
        let el = age - d.delay;
        if el < 0.0 {
            if !text.0.is_empty() {
                text.0.clear();
            }
            continue;
        }
        if el * d.cps > d.text.chars().count() as f32 + 6.0 {
            if text.0 != d.text {
                text.0.clone_from(&d.text);
            }
            continue;
        }
        decoded(&mut buf, &d.text, el, d.cps);
        if text.0 != *buf {
            text.0.clone_from(&buf);
        }
    }
    let ck = ((age - 0.4) / 1.2).clamp(0.0, 1.0);
    let ck = 1.0 - (1.0 - ck).powi(2);
    for (c, mut text) in &mut count {
        let v = (c.to * ck).round() as i32;
        buf.clear();
        use std::fmt::Write as _;
        let _ = match c.kind {
            CountKind::Int => write!(buf, "{v}"),
            CountKind::Percent => write!(buf, "{v}%"),
            CountKind::Clock => write!(buf, "{}:{:02}", v / 60, v % 60),
        };
        if text.0 != *buf {
            text.0.clone_from(&buf);
        }
    }
    for (r, mut vis) in &mut reveal {
        let want = if age >= r.0 { Visibility::Inherited } else { Visibility::Hidden };
        if *vis != want {
            *vis = want;
        }
    }
}

// ---------- mission end ----------

/// MissionEndMsg -> debrief data, campaign progress and story state (web onMissionEnd()), Debrief state.
/// mission.rs writes `MissionResult` in the same system that sends the message, so it is complete here.
/// - win: the mission's `set` flags, kills and score count, `current` moves to `next`;
/// - objective lost (not a death) with a `lose` branch: `lose.set` flags, kills and score count,
///   `current` moves to `lose.next`;
/// - otherwise (death, or a failure without a branch): nothing changes, the mission is flown again.
#[allow(clippy::too_many_arguments)]
fn catch_mission_end(
    mut ends: MessageReader<MissionEndMsg>,
    state: Res<State<AppState>>,
    mut next: ResMut<NextState<AppState>>,
    result: Res<MissionResult>,
    data: Res<GameData>,
    camp: Res<Campaign2>,
    mut progress: ResMut<Progress>,
    mut story: ResMut<Story>,
    mut debrief: ResMut<Debriefing>,
) {
    let Some(end) = ends.read().last().cloned() else { return };
    let idx = result.mission.min(data.campaign.missions.len().saturating_sub(1));
    let m = data.mission(idx);
    let lose = m.extra.get("lose");
    let texts = camp.texts(idx);
    // the story branches when an objective is lost while the pilot survived
    let outcome = if end.win {
        Outcome::Win
    } else if lose.is_some() && !result.death {
        Outcome::Branch
    } else {
        Outcome::Lose
    };
    let stats = FlightStats { kills: result.kills, shots: result.shots, hits: result.hits, time: result.time, score: result.score };
    let old_rank = camp.rank(progress.total_kills);
    let (next_idx, title, flags) = match outcome {
        Outcome::Win => (camp.index(m.next.as_ref()), String::new(), texts.map(|t| t.set.clone())),
        Outcome::Branch => {
            let l = lose.expect("lose branch");
            (camp.index(l.get("next")), l["title"].as_str().unwrap_or_default().to_string(), texts.map(|t| t.lose_set.clone()))
        }
        Outcome::Lose => (None, String::new(), None),
    };
    if outcome != Outcome::Lose {
        story.0.flags.extend(flags.unwrap_or_default());
        story.0.score += stats.score;
        progress.total_kills += stats.kills;
        if let Some(n) = next_idx {
            progress.current = n;
            progress.unlocked = progress.unlocked.max(n);
        }
        save_json("progress.json", &*progress);
        save_json(STORY_FILE, &story.0);
    }
    // the radio lines after the mission, filtered with the flags this result just set (web: after Object.assign)
    let lines = match (outcome, texts) {
        (Outcome::Win, Some(t)) => visible_lines(&t.win, &story.0),
        (Outcome::Branch, Some(t)) => visible_lines(&t.lose, &story.0),
        _ => Vec::new(),
    };
    let rank = camp.rank(progress.total_kills);
    *debrief = Debriefing {
        mission: idx,
        outcome,
        reason: end.reason.clone(),
        title,
        lines,
        stats,
        next: next_idx,
        total_kills: progress.total_kills,
        promoted: rank != old_rank,
        rank,
    };
    if *state.get() == AppState::Flight {
        next.set(AppState::Debrief);
    }
}

/// Esc / P / Start in the settings opened from the pause screen: flight.rs has just toggled the pause off
/// (its input runs first); turn it back on and return to the pause screen instead of resuming the flight.
fn pause_settings_back(
    keys: Res<ButtonInput<KeyCode>>,
    pads: Query<&Gamepad>,
    state: Res<State<AppState>>,
    mut paused: ResMut<Paused>,
    mut nav: ResMut<MenuNav>,
) {
    if *state.get() != AppState::Flight || !nav.pause_settings || paused.0 {
        return;
    }
    if keys.any_just_pressed([KeyCode::Escape, KeyCode::KeyP]) || pads.iter().any(|p| p.just_pressed(GamepadButton::Start)) {
        paused.0 = true;
        nav.pause_settings = false;
    }
}

// ---------- test hook ----------

/// `SF_UI_SHOT=title|missions|settings|controls|briefing|debrief|debrief-lose|pause` opens that screen at start
/// (with sample data where needed) for automated screenshots; `SF_UI_UNLOCK=<n>` unlocks missions.
#[allow(clippy::too_many_arguments)]
fn ui_test_hook(
    time: Res<Time>,
    mut done: Local<u8>,
    mut t: Local<f32>,
    mut nav: ResMut<MenuNav>,
    mut next: ResMut<NextState<AppState>>,
    mut paused: ResMut<Paused>,
    mut progress: ResMut<Progress>,
    mut ends: MessageWriter<MissionEndMsg>,
    mut result: ResMut<MissionResult>,
) {
    let Ok(what) = std::env::var("SF_UI_SHOT") else { return };
    *t += time.delta_secs();
    if *done == 0 {
        *done = 1;
        if let Some(n) = std::env::var("SF_UI_UNLOCK").ok().and_then(|s| s.parse().ok()) {
            progress.unlocked = n;
            progress.current = n;
            progress.total_kills = 7;
        }
        match what.as_str() {
            "missions" => nav.menu = MenuScreen::Missions,
            "settings" => nav.menu = MenuScreen::Settings,
            "controls" => nav.menu = MenuScreen::Controls,
            "briefing" => next.set(AppState::Briefing),
            "pause" | "debrief" | "debrief-lose" | "debrief-branch" => next.set(AppState::Flight),
            _ => {}
        }
    } else if *done == 1 && *t > 2.5 {
        *done = 2;
        match what.as_str() {
            "pause" => paused.0 = true,
            "debrief" | "debrief-lose" | "debrief-branch" => {
                let win = what == "debrief";
                let reason = if win { "Alle Navpunkte gesichert." } else { "Die Samariter wurde zerstört." };
                *result = MissionResult {
                    mission: progress.current,
                    win,
                    reason: reason.into(),
                    death: what == "debrief-lose",
                    kills: 9,
                    shots: 240,
                    hits: 86,
                    score: 1140,
                    time: 412.0,
                };
                ends.write(MissionEndMsg { win, reason: reason.into() });
            }
            _ => {}
        }
    }
}

/// `SF_UI_KEYS=enter,down,wait,esc,...`: presses one key every 0.7 s, starting after 3 s (scripted menu tests).
fn key_script(time: Res<Time>, mut keys: ResMut<ButtonInput<KeyCode>>, mut t: Local<f32>, mut step: Local<usize>, mut held: Local<Option<KeyCode>>) {
    if let Some(k) = held.take() {
        keys.release(k);
    }
    *t += time.delta_secs();
    if *t < 3.0 + *step as f32 * 0.7 {
        return;
    }
    let script = std::env::var("SF_UI_KEYS").unwrap_or_default();
    let Some(name) = script.split(',').nth(*step) else { return };
    *step += 1;
    let key = match name.trim() {
        "up" => KeyCode::ArrowUp,
        "down" => KeyCode::ArrowDown,
        "left" => KeyCode::ArrowLeft,
        "right" => KeyCode::ArrowRight,
        "enter" => KeyCode::Enter,
        "esc" => KeyCode::Escape,
        _ => return,
    };
    info!("key script: {name}");
    keys.press(key);
    *held = Some(key);
}
