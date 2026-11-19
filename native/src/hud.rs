//! Flight HUD (bevy_ui) and the shared holographic UI look (fonts, palette, panels) that menu.rs builds on.
//!
//! Everything is laid out on a 1920×1080 reference canvas; `UiScale` maps it onto the window. World markers
//! (reticle, lead, target brackets, nav, objective markers, off-screen arrows, radar, lens flare) are projected
//! in PostUpdate after the camera rig moved, so they never lag a frame behind the 3D view. Elements are
//! spawned once per mission and only re-coloured / moved afterwards; text is rewritten only when it changes.

use crate::common::*;
use crate::render::SkyInfo;
use crate::weapons::{PlayerAim, SeekerWarning};
use bevy::asset::io::file::FileAssetReader;
use bevy::camera::CameraUpdateSystems;
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use bevy::text::{FontSize, FontSource, Justify, LetterSpacing};
use bevy::transform::TransformSystems;
use bevy::ui::UiSystems;
use bevy::window::PrimaryWindow;
use std::collections::VecDeque;
use std::f32::consts::{FRAC_PI_4, PI, TAU};
use std::fmt::Write as _;

// ---------- palette (web: style.css) ----------

const fn rgba(r: u8, g: u8, b: u8, a: f32) -> Color {
    Color::srgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, a)
}
pub const CYAN: Color = rgba(127, 214, 255, 1.0);
pub const GREEN: Color = rgba(109, 255, 176, 1.0);
pub const AMBER: Color = rgba(255, 200, 87, 1.0);
pub const RED: Color = rgba(255, 77, 109, 1.0);
pub const ORANGE: Color = rgba(255, 138, 42, 1.0);
pub const INK: Color = rgba(230, 244, 255, 1.0);
pub const MUTED: Color = rgba(159, 180, 200, 1.0);
pub const WHITE: Color = rgba(242, 251, 255, 1.0);
/// translucent panel background and its thin border
pub const PANEL: Color = rgba(6, 16, 30, 0.72);
pub const LINE: Color = rgba(127, 214, 255, 0.3);
pub const DIM: Color = rgba(127, 214, 255, 0.35);
const BAR_BG: Color = rgba(8, 16, 28, 0.6);
const SHIELD_COL: Color = rgba(70, 170, 255, 0.9);
const HULL_OK: Color = rgba(110, 230, 160, 0.85);
const HULL_LOW: Color = rgba(255, 70, 90, 0.92);
const BOOST_COL: Color = rgba(255, 170, 60, 0.88);
const IMPULSE_COL: Color = rgba(127, 214, 255, 0.9);
const NEUTRAL: Color = rgba(159, 232, 255, 1.0);
const SHADOW: TextShadow = TextShadow { offset: Vec2::new(1.0, 1.5), color: Color::srgba(0.0, 0.0, 0.0, 0.8) };

/// Reference canvas height: all UI sizes are in pixels of a 1080p screen.
pub const REF_H: f32 = 1080.0;

/// The game's fonts (Orbitron for display text, Rajdhani for body text).
#[derive(Resource, Clone)]
pub struct UiFonts {
    pub display: Handle<Font>,
    pub bold: Handle<Font>,
    pub semi: Handle<Font>,
}

impl FromWorld for UiFonts {
    /// Loaded through the AssetServer from `assets/fonts` (crate dir under cargo, next to the exe in the
    /// release zip); a copy is compiled in for binaries started from anywhere else.
    fn from_world(world: &mut World) -> Self {
        let root = FileAssetReader::get_base_path().join("assets/fonts");
        let mut load = |file: &str, bytes: &'static [u8]| -> Handle<Font> {
            if root.join(file).exists() {
                world.resource::<AssetServer>().load(format!("fonts/{file}"))
            } else {
                world.resource_mut::<Assets<Font>>().add(Font::from_bytes(bytes.to_vec()))
            }
        };
        Self {
            display: load("Orbitron-ExtraBold.ttf", include_bytes!("../assets/fonts/Orbitron-ExtraBold.ttf")),
            bold: load("Rajdhani-Bold.ttf", include_bytes!("../assets/fonts/Rajdhani-Bold.ttf")),
            semi: load("Rajdhani-SemiBold.ttf", include_bytes!("../assets/fonts/Rajdhani-SemiBold.ttf")),
        }
    }
}

pub fn font(h: &Handle<Font>, size: f32) -> TextFont {
    TextFont { font: FontSource::Handle(h.clone()), font_size: FontSize::Px(size), ..default() }
}

/// A text node: font, size, colour, letter spacing.
pub fn label(h: &Handle<Font>, size: f32, color: Color, spacing: f32, s: impl Into<String>) -> impl Bundle {
    (Text::new(s), font(h, size), TextColor(color), LetterSpacing::Px(spacing), SHADOW)
}

/// Absolutely placed node at the canvas origin (moved with `UiTransform`).
pub fn abs_node(w: f32, h: f32) -> Node {
    Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), width: px(w), height: px(h), ..default() }
}

/// Four bright L-shaped corner accents (holographic panel frame); the parent must be relatively positioned.
pub fn corner_accents(p: &mut ChildSpawnerCommands, color: Color, len: f32, inset: f32) {
    let t = px(2.0);
    for (top, left) in [(true, true), (true, false), (false, true), (false, false)] {
        let mut n = Node { position_type: PositionType::Absolute, width: px(len), height: px(len), ..default() };
        let mut b = UiRect::ZERO;
        if top {
            n.top = px(inset);
            b.top = t;
        } else {
            n.bottom = px(inset);
            b.bottom = t;
        }
        if left {
            n.left = px(inset);
            b.left = t;
        } else {
            n.right = px(inset);
            b.right = t;
        }
        n.border = b;
        p.spawn((n, BorderColor::all(color), Pickable::IGNORE));
    }
}

/// Fits the 1080p reference canvas into the window (narrow windows are limited by their width).
fn fit_ui_scale(windows: Query<&Window, With<PrimaryWindow>>, mut scale: ResMut<UiScale>) {
    let Ok(w) = windows.single() else { return };
    let (ww, wh) = (w.width(), w.height());
    if ww < 1.0 || wh < 1.0 {
        return;
    }
    let s = (wh / REF_H).min(ww / 1920.0 * 1.25).clamp(0.4, 4.0);
    if (scale.0 - s).abs() > 1e-3 {
        scale.0 = s;
    }
}

/// Glyphs for the "decoding" text effect.
const GLYPHS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$<>/\\|=+*";

/// Text that decodes from random glyphs: `elapsed` seconds after it appeared, `cps` characters per second.
pub fn decoded(out: &mut String, text: &str, elapsed: f32, cps: f32) {
    out.clear();
    let n = (elapsed.max(0.0) * cps) as usize;
    let seed = (elapsed * 20.0) as usize;
    for (i, ch) in text.chars().enumerate() {
        if i < n {
            out.push(ch);
        } else if i < n + 5 {
            out.push(if ch == ' ' { ' ' } else { GLYPHS[(seed * 7 + i * 13) % GLYPHS.len()] as char });
        } else {
            break;
        }
    }
}

/// Orbitron lacks a few glyphs the campaign texts use (· „ “ ”): swap them for ones it has.
pub fn display_safe(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '·' => '•',
            '„' | '“' | '”' => '"',
            '‚' | '‘' => '\'',
            c => c,
        })
        .collect::<String>()
        .to_uppercase()
}

/// Character colour from campaign.json ("#5fb8ff"), cyan for unknown speakers.
pub fn char_color(data: &GameData, who: &str) -> Color {
    data.campaign.chars.get(who).and_then(|c| Srgba::hex(c.color.trim_start_matches('#')).ok()).map(Color::Srgba).unwrap_or(CYAN)
}

fn with_alpha(c: Color, a: f32) -> Color {
    c.with_alpha(c.alpha() * a)
}

/// "312 M/S", or "2,34 KM/S" under the impulse drive
fn speed_text(out: &mut String, v: f32) {
    out.clear();
    if v >= 1000.0 {
        let c = (v / 10.0).round() as i32;
        let _ = write!(out, "{},{:02} KM/S", c / 100, c % 100);
    } else {
        let _ = write!(out, "{} M/S", v.round() as i32);
    }
}

/// "820 M" / "3,4 KM"
fn dist_text(out: &mut String, d: f32) {
    if d < 1000.0 {
        let _ = write!(out, "{} M", d.round() as i32);
    } else {
        let tenths = (d / 100.0).round() as i32;
        let _ = write!(out, "{},{} KM", tenths / 10, tenths % 10);
    }
}

// ---------- plugin ----------

/// Big centre-screen announcement ("SEKTOR GESICHERT", "NEUE FEINDWELLE", ...): any module may send it.
#[derive(Message, Clone, Debug)]
pub struct HudBanner(pub String);

/// HUD switches for other modules.
#[derive(Resource, Clone, Debug)]
pub struct HudConfig {
    /// whole HUD on/off (cutscenes, launch sequence)
    pub visible: bool,
    /// show the 2D radar in the cockpit view too (off once the cockpit draws its own radar display)
    pub radar_in_cockpit: bool,
}

impl Default for HudConfig {
    fn default() -> Self {
        Self { visible: true, radar_in_cockpit: true }
    }
}

pub struct HudPlugin;

impl Plugin for HudPlugin {
    fn build(&self, app: &mut App) {
        let flying = in_state(AppState::Flight);
        app.init_resource::<UiFonts>()
            .init_resource::<HudConfig>()
            .init_resource::<HudAnim>()
            .init_resource::<CommQueue>()
            .add_message::<HudBanner>()
            .add_systems(Update, fit_ui_scale)
            .add_systems(OnEnter(AppState::Flight), (spawn_hud, start_cine))
            .add_systems(OnExit(AppState::Flight), |mut c: Commands, mut q: ResMut<CommQueue>| {
                c.remove_resource::<HudIds>();
                *q = CommQueue::default();
            })
            .add_systems(Update, (hud_test_hook, hud_status, hud_comm, hud_alerts).chain().run_if(flying.clone()).run_if(resource_exists::<HudIds>))
            .add_systems(
                PostUpdate,
                hud_world
                    .after(crate::render::CameraRigSet)
                    .after(TransformSystems::Propagate)
                    .after(CameraUpdateSystems)
                    .before(UiSystems::Prepare)
                    .run_if(flying)
                    .run_if(resource_exists::<HudIds>),
            );
    }
}

// ---------- spawned element handles ----------

#[derive(Clone, Copy)]
struct Bar {
    fill: Entity,
    label: Entity,
    value: Entity,
}

/// A label centred on a point: `root` is a fixed-width box, `text` its text child.
#[derive(Clone, Copy)]
struct Tag {
    root: Entity,
    text: Entity,
}
const TAG_W: f32 = 420.0;

#[derive(Resource)]
struct HudIds {
    root: Entity,
    // status panel
    shield: Bar,
    hull: Bar,
    boost: Bar,
    speed: Entity,
    neutron: Entity,
    thr_fill: Entity,
    thr_want: Entity,
    thr_val: Entity,
    // target panel
    tgt_panel: Entity,
    tgt_name: Entity,
    tgt_class: Entity,
    tgt_dist: Entity,
    tgt_shield_row: Entity,
    tgt_shield: Bar,
    tgt_hull: Bar,
    // objective
    obj_text: Entity,
    obj_lines: [Entity; 2],
    hostiles: Entity,
    timer: Entity,
    auto_hint: Entity,
    // comm
    comm: Entity,
    comm_portrait: Entity,
    comm_initials: Entity,
    comm_name: Entity,
    comm_text: Entity,
    comm_bars: [Entity; 4],
    // radar
    radar: Entity,
    radar_sweep: Entity,
    blips: Vec<Entity>,
    // world markers
    reticle: Entity,
    reticle_parts: Vec<Entity>,
    lead: Entity,
    lead_parts: Vec<Entity>,
    lead_tag: Tag,
    brackets: Entity,
    bracket_corners: [Entity; 4],
    tgt_tag: Tag,
    lock_ring: Entity,
    lock_diamond: Entity,
    lock_tag: Tag,
    nav: Entity,
    nav_tag: Tag,
    arrows: [Entity; 2],
    markers: Vec<(Entity, Tag)>,
    foes: Vec<Entity>,
    friends: Vec<Entity>,
    flare: Vec<Entity>,
    vignette: Entity,
    // alerts
    warn_seeker: Entity,
    warn_shield: Entity,
    dead: Entity,
    banner: Entity,
    banner_text: Entity,
    banner_lines: [Entity; 2],
    cine: Entity,
    cine_kicker: Entity,
    cine_title: Entity,
    cine_sub: Entity,
    cine_lines: [Entity; 2],
}

/// Animation timers and change trackers.
#[derive(Resource, Default)]
struct HudAnim {
    time: f32,
    target: Option<Entity>,
    target_t: f32,
    obj_src: String,
    obj_upper: String,
    obj_t: f32,
    target_name: String,
    hurt: f32,
    hurt_q: i32,
    flare_q: i32,
    banner: String,
    banner_t: f32,
    cine_t: f32,
    cine: [String; 3],
    view: Option<View>,
}

/// Radio messages waiting for the comm box.
#[derive(Resource, Default)]
struct CommQueue {
    queue: VecDeque<CommLine>,
    current: Option<CommLine>,
    t: f32,
    fresh: bool,
}

#[derive(Clone)]
struct CommLine {
    name: String,
    initials: String,
    color: Color,
    text: String,
    chars: usize,
    dur: f32,
}

// ---------- writing helpers ----------

/// Mutable access to the UI components the HUD changes; every setter skips unchanged values so change
/// detection (and with it text layout / UI extraction work) only fires for real changes.
#[derive(SystemParam)]
struct Ui<'w, 's> {
    nodes: Query<'w, 's, &'static mut Node>,
    texts: Query<'w, 's, &'static mut Text>,
    vis: Query<'w, 's, &'static mut Visibility>,
    xf: Query<'w, 's, &'static mut UiTransform>,
    bg: Query<'w, 's, &'static mut BackgroundColor>,
    border: Query<'w, 's, &'static mut BorderColor>,
    tcol: Query<'w, 's, &'static mut TextColor>,
    grad: Query<'w, 's, &'static mut BackgroundGradient>,
    spacing: Query<'w, 's, &'static mut LetterSpacing>,
}

impl Ui<'_, '_> {
    fn show(&mut self, e: Entity, on: bool) {
        if let Ok(mut v) = self.vis.get_mut(e) {
            let want = if on { Visibility::Inherited } else { Visibility::Hidden };
            if *v != want {
                *v = want;
            }
        }
    }
    fn text(&mut self, e: Entity, s: &str) {
        if let Ok(mut t) = self.texts.get_mut(e)
            && t.0 != s
        {
            t.0.clear();
            t.0.push_str(s);
        }
    }
    /// translation, rotation (clockwise, radians) and uniform scale
    fn place(&mut self, e: Entity, pos: Vec2, rot: f32, scale: f32) {
        if let Ok(mut t) = self.xf.get_mut(e) {
            let want = UiTransform { translation: Val2::px(pos.x, pos.y), scale: Vec2::splat(scale), rotation: Rot2::radians(rot) };
            if *t != want {
                *t = want;
            }
        }
    }
    /// centre a node of size `size` on `p`
    fn center(&mut self, e: Entity, p: Vec2, size: Vec2, rot: f32, scale: f32) {
        self.place(e, p - size * 0.5, rot, scale);
    }
    /// centre a tag horizontally on `p`, its top at p.y
    fn tag(&mut self, t: Tag, p: Vec2, s: &str, color: Color) {
        self.show(t.root, true);
        self.place(t.root, Vec2::new(p.x - TAG_W * 0.5, p.y), 0.0, 1.0);
        self.text(t.text, s);
        self.text_color(t.text, color);
    }
    fn width_pct(&mut self, e: Entity, k: f32) {
        if let Ok(mut n) = self.nodes.get_mut(e) {
            let want = percent((k.clamp(0.0, 1.0) * 1000.0).round() / 10.0);
            if n.width != want {
                n.width = want;
            }
        }
    }
    fn size(&mut self, e: Entity, w: f32, h: f32) {
        if let Ok(mut n) = self.nodes.get_mut(e) {
            let (w, h) = (px(w.round()), px(h.round()));
            if n.width != w || n.height != h {
                n.width = w;
                n.height = h;
            }
        }
    }
    fn bg(&mut self, e: Entity, c: Color) {
        if let Ok(mut b) = self.bg.get_mut(e)
            && b.0 != c
        {
            b.0 = c;
        }
    }
    fn border(&mut self, e: Entity, c: Color) {
        if let Ok(mut b) = self.border.get_mut(e) {
            let want = BorderColor::all(c);
            if *b != want {
                *b = want;
            }
        }
    }
    fn text_color(&mut self, e: Entity, c: Color) {
        if let Ok(mut t) = self.tcol.get_mut(e)
            && t.0 != c
        {
            t.0 = c;
        }
    }
    /// set the colour of a compound shape: borders and filled parts
    fn tint(&mut self, parts: &[Entity], c: Color) {
        for &e in parts {
            if self.bg.get(e).is_ok_and(|b| b.0.alpha() > 0.0) {
                self.bg(e, c);
            }
            if self.border.get(e).is_ok_and(|b| !b.is_fully_transparent()) {
                self.border(e, c);
            }
        }
    }
    fn letter_spacing(&mut self, e: Entity, s: f32) {
        if let Ok(mut l) = self.spacing.get_mut(e) {
            let want = LetterSpacing::Px((s * 2.0).round() / 2.0);
            if *l != want {
                *l = want;
            }
        }
    }
}

// ---------- spawning ----------

fn spawn_bar(p: &mut ChildSpawnerCommands, f: &UiFonts, w: f32, h: f32, color: Color, text: &str) -> Bar {
    let mut fill = Entity::PLACEHOLDER;
    let mut label_e = Entity::PLACEHOLDER;
    let mut value = Entity::PLACEHOLDER;
    p.spawn((Node { width: px(w), height: px(h), border: UiRect::all(px(1.0)), ..default() }, BackgroundColor(BAR_BG), BorderColor::all(DIM)))
        .with_children(|b| {
            fill = b
                .spawn((
                    Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), height: percent(100.0), width: percent(100.0), ..default() },
                    BackgroundColor(color),
                ))
                .id();
            // segment gaps (web: 20 segments)
            let inner = w - 2.0;
            for i in 1..20 {
                b.spawn((
                    Node { position_type: PositionType::Absolute, left: px(inner * i as f32 / 20.0 - 1.0), top: px(0.0), width: px(1.5), height: percent(100.0), ..default() },
                    BackgroundColor(rgba(4, 10, 18, 0.75)),
                ));
            }
            b.spawn(Node {
                position_type: PositionType::Absolute,
                left: px(0.0),
                right: px(0.0),
                top: px(0.0),
                bottom: px(0.0),
                padding: UiRect::horizontal(px(8.0)),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::SpaceBetween,
                ..default()
            })
            .with_children(|row| {
                label_e = row.spawn(label(&f.bold, h * 0.72, rgba(234, 247, 255, 1.0), 1.2, text)).id();
                value = row.spawn(label(&f.bold, h * 0.72, rgba(234, 247, 255, 1.0), 0.8, "")).id();
            });
        });
    Bar { fill, label: label_e, value }
}

fn spawn_tag(p: &mut ChildSpawnerCommands, f: &Handle<Font>, size: f32, color: Color) -> Tag {
    let mut text = Entity::PLACEHOLDER;
    let root = p
        .spawn((
            Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), width: px(TAG_W), justify_content: JustifyContent::Center, ..default() },
            Visibility::Hidden,
        ))
        .with_children(|b| {
            text = b.spawn((label(f, size, color, 1.5, ""), TextLayout::justify(Justify::Center))).id();
        })
        .id();
    Tag { root, text }
}

/// Square outline (rotate it 45° for a diamond).
fn spawn_frame(p: &mut ChildSpawnerCommands, size: f32, width: f32, color: Color, round: bool) -> Entity {
    let mut n = abs_node(size, size);
    n.border = UiRect::all(px(width));
    if round {
        n.border_radius = BorderRadius::MAX;
    }
    p.spawn((n, BorderColor::all(color), Visibility::Hidden)).id()
}

fn spawn_hud(mut commands: Commands, f: Res<UiFonts>, cam: Query<Entity, With<MainCamera>>, data: Res<GameData>, progress: Res<Progress>, mut anim: ResMut<HudAnim>) {
    *anim = HudAnim::default();
    let m = data.mission(progress.current);
    let ship_name = data.ship(&m.ship).name.to_uppercase();
    let mut root_cmd = commands.spawn((
        Node { width: percent(100.0), height: percent(100.0), position_type: PositionType::Absolute, ..default() },
        Pickable::IGNORE,
        DespawnOnExit(AppState::Flight),
        Name::new("HUD"),
    ));
    if let Ok(c) = cam.single() {
        root_cmd.insert(UiTargetCamera(c));
    }
    let root = root_cmd.id();
    let mut b = HudBuilder::default();
    commands.entity(root).with_children(|p| b.build(p, &f, &ship_name));
    let ids = b.finish(root);
    commands.insert_resource(ids);
}

/// Collects entity ids while the HUD tree is spawned.
#[derive(Default)]
struct HudBuilder {
    e: Vec<Entity>,
    bars: Vec<Bar>,
    tags: Vec<Tag>,
    reticle_parts: Vec<Entity>,
    lead_parts: Vec<Entity>,
    blips: Vec<Entity>,
    markers: Vec<(Entity, Tag)>,
    foes: Vec<Entity>,
    friends: Vec<Entity>,
    flare: Vec<Entity>,
}

impl HudBuilder {
    fn build(&mut self, p: &mut ChildSpawnerCommands, f: &UiFonts, ship_name: &str) {
        // --- back layer: lens flare, damage vignette ---
        for _ in 0..6 {
            let mut n = abs_node(100.0, 100.0);
            n.border_radius = BorderRadius::MAX;
            self.flare.push(p.spawn((n, BackgroundGradient::default(), Visibility::Hidden)).id());
        }
        self.flare.push(p.spawn((abs_node(1200.0, STREAK_H), BackgroundGradient::default(), Visibility::Hidden)).id());
        let vignette = p
            .spawn((
                Node { position_type: PositionType::Absolute, width: percent(100.0), height: percent(100.0), ..default() },
                BackgroundGradient::default(),
                Visibility::Hidden,
            ))
            .id();
        self.e.push(vignette); // 0

        // --- world markers ---
        for _ in 0..32 {
            let e = spawn_frame(p, 13.0, 1.5, RED, false);
            self.foes.push(e);
        }
        for _ in 0..24 {
            let e = spawn_frame(p, 14.0, 1.5, GREEN, true);
            self.friends.push(e);
        }
        for _ in 0..6 {
            let sq = spawn_frame(p, 22.0, 2.0, GREEN, false);
            let tag = spawn_tag(p, &f.bold, 17.0, GREEN);
            self.markers.push((sq, tag));
        }
        let nav = spawn_frame(p, 24.0, 2.5, AMBER, false);
        self.e.push(nav); // 1
        self.tags.push(spawn_tag(p, &f.bold, 18.0, AMBER)); // nav tag 0

        // target brackets: a box whose four corners are L-shapes (sized in percent of the box)
        let mut corners = [Entity::PLACEHOLDER; 4];
        let brackets = p
            .spawn((abs_node(60.0, 60.0), Visibility::Hidden))
            .with_children(|b| {
                for (i, (top, left)) in [(true, true), (true, false), (false, true), (false, false)].into_iter().enumerate() {
                    let mut n = Node { position_type: PositionType::Absolute, width: percent(32.0), height: percent(32.0), ..default() };
                    let w = px(2.5);
                    if top {
                        n.top = px(0.0);
                        n.border.top = w;
                    } else {
                        n.bottom = px(0.0);
                        n.border.bottom = w;
                    }
                    if left {
                        n.left = px(0.0);
                        n.border.left = w;
                    } else {
                        n.right = px(0.0);
                        n.border.right = w;
                    }
                    corners[i] = b.spawn((n, BorderColor::all(RED))).id();
                }
            })
            .id();
        self.e.push(brackets); // 2
        self.e.extend(corners); // 3..=6
        self.tags.push(spawn_tag(p, &f.bold, 18.0, RED)); // target distance tag 1

        // seeker lock: travelling ring, then a spinning diamond
        let lock_ring = spawn_frame(p, 52.0, 2.0, AMBER, true);
        let lock_diamond = spawn_frame(p, 60.0, 2.5, RED, false);
        self.e.extend([lock_ring, lock_diamond]); // 7, 8
        self.tags.push(spawn_tag(p, &f.display, 13.0, AMBER)); // lock tag 2

        // lead pipper: circle, centre cross, four lock ticks
        let lead = p
            .spawn((abs_node(56.0, 56.0), Visibility::Hidden))
            .with_children(|b| {
                let mut ring = Node { position_type: PositionType::Absolute, left: px(17.0), top: px(17.0), width: px(22.0), height: px(22.0), ..default() };
                ring.border = UiRect::all(px(2.0));
                ring.border_radius = BorderRadius::MAX;
                self.lead_parts.push(b.spawn((ring, BorderColor::all(AMBER))).id());
                for (x, y, w, h) in [(23.0, 27.0, 10.0, 2.0), (27.0, 23.0, 2.0, 10.0)] {
                    let n = Node { position_type: PositionType::Absolute, left: px(x), top: px(y), width: px(w), height: px(h), ..default() };
                    self.lead_parts.push(b.spawn((n, BackgroundColor(AMBER))).id());
                }
                // lock ticks (diagonal), only while the guns converge
                for (x, y) in [(4.0, 4.0), (44.0, 4.0), (4.0, 44.0), (44.0, 44.0)] {
                    let n = Node { position_type: PositionType::Absolute, left: px(x), top: px(y), width: px(8.0), height: px(8.0), ..default() };
                    self.lead_parts.push(b.spawn((n, BackgroundColor(GREEN), UiTransform::from_rotation(Rot2::radians(FRAC_PI_4)))).id());
                }
            })
            .id();
        self.e.push(lead); // 9
        self.tags.push(spawn_tag(p, &f.display, 12.0, GREEN)); // lead tag 3

        // reticle: ring with four ticks and a centre dot
        let reticle = p
            .spawn((abs_node(60.0, 60.0), Visibility::Hidden))
            .with_children(|b| {
                let mut ring = Node { position_type: PositionType::Absolute, left: px(14.0), top: px(14.0), width: px(32.0), height: px(32.0), ..default() };
                ring.border = UiRect::all(px(1.8));
                ring.border_radius = BorderRadius::MAX;
                self.reticle_parts.push(b.spawn((ring, BorderColor::all(CYAN))).id());
                for (x, y, w, h) in [(29.0, 4.0, 2.0, 9.0), (29.0, 47.0, 2.0, 9.0), (4.0, 29.0, 9.0, 2.0), (47.0, 29.0, 9.0, 2.0), (28.5, 28.5, 3.0, 3.0)] {
                    let n = Node { position_type: PositionType::Absolute, left: px(x), top: px(y), width: px(w), height: px(h), ..default() };
                    self.reticle_parts.push(b.spawn((n, BackgroundColor(CYAN))).id());
                }
            })
            .id();
        self.e.push(reticle); // 10

        // off-screen arrows: chevrons (square with two borders, rotated)
        for col in [RED, AMBER] {
            let mut n = abs_node(22.0, 22.0);
            n.border = UiRect { top: px(4.0), right: px(4.0), ..UiRect::ZERO };
            self.e.push(p.spawn((n, BorderColor::all(col), Visibility::Hidden)).id()); // 11, 12
        }

        // --- status panel (top left) ---
        p.spawn((
            Node {
                position_type: PositionType::Absolute,
                left: px(28.0),
                top: px(24.0),
                width: px(300.0),
                flex_direction: FlexDirection::Column,
                row_gap: px(6.0),
                padding: UiRect::all(px(12.0)),
                border: UiRect::all(px(1.0)),
                ..default()
            },
            BackgroundColor(rgba(6, 16, 30, 0.55)),
            BorderColor::all(LINE),
        ))
        .with_children(|s| {
            corner_accents(s, CYAN, 10.0, 3.0);
            s.spawn(Node { justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::Center, ..default() }).with_children(|r| {
                self.e.push(r.spawn(label(&f.display, 14.0, CYAN, 3.0, ship_name)).id()); // 13
                r.spawn(label(&f.display, 11.0, ORANGE, 2.5, "STATUS"));
            });
            let w = 274.0;
            let shield = spawn_bar(s, f, w, 22.0, SHIELD_COL, "SCHILD");
            let hull = spawn_bar(s, f, w, 22.0, HULL_OK, "HÜLLE");
            let boost = spawn_bar(s, f, w, 22.0, BOOST_COL, "BOOST");
            self.bars.extend([shield, hull, boost]);
            s.spawn(Node { justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::FlexEnd, margin: UiRect::top(px(2.0)), ..default() })
                .with_children(|r| {
                    self.e.push(r.spawn(label(&f.display, 22.0, WHITE, 1.5, "0 M/S")).id()); // 14 speed
                    self.e.push(r.spawn(label(&f.bold, 19.0, AMBER, 1.5, "NEUTRON 0")).id()); // 15 neutron
                });
            // throttle: bar with the set speed and a caret for the speed the ship is accelerating to
            s.spawn(Node { align_items: AlignItems::Center, column_gap: px(8.0), ..default() }).with_children(|r| {
                r.spawn(label(&f.bold, 15.0, CYAN, 1.5, "SCHUB"));
                r.spawn((Node { width: px(176.0), height: px(8.0), border: UiRect::all(px(1.0)), ..default() }, BackgroundColor(BAR_BG), BorderColor::all(DIM)))
                    .with_children(|t| {
                        self.e.push(
                            t.spawn((
                                Node { position_type: PositionType::Absolute, left: px(0.0), top: px(0.0), height: percent(100.0), width: percent(75.0), ..default() },
                                BackgroundColor(rgba(127, 214, 255, 0.8)),
                            ))
                            .id(),
                        ); // 16 thr fill
                        self.e.push(
                            t.spawn((
                                Node { position_type: PositionType::Absolute, left: percent(50.0), top: px(-4.0), width: px(3.0), height: px(14.0), ..default() },
                                BackgroundColor(WHITE),
                            ))
                            .id(),
                        ); // 17 want caret
                    });
                self.e.push(r.spawn(label(&f.bold, 15.0, INK, 1.0, "75 %")).id()); // 18 thr value
            });
        });

        // --- target panel (top right) ---
        let tgt = p
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    right: px(28.0),
                    top: px(24.0),
                    width: px(320.0),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(5.0),
                    padding: UiRect::all(px(12.0)),
                    border: UiRect::all(px(1.0)),
                    ..default()
                },
                BackgroundColor(rgba(6, 16, 30, 0.55)),
                BorderColor::all(rgba(255, 77, 109, 0.35)),
                Visibility::Hidden,
            ))
            .with_children(|s| {
                corner_accents(s, RED, 10.0, 3.0);
                s.spawn(Node { justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::Center, ..default() }).with_children(|r| {
                    r.spawn(label(&f.display, 11.0, ORANGE, 3.0, "ZIEL"));
                    self.e.push(r.spawn(label(&f.bold, 19.0, WHITE, 1.0, "")).id()); // 20 dist
                });
                self.e.push(s.spawn(label(&f.display, 18.0, RED, 2.0, "")).id()); // 21 name
                self.e.push(s.spawn(label(&f.semi, 15.0, MUTED, 1.5, "")).id()); // 22 class
                let row = s
                    .spawn(Node::default())
                    .with_children(|r| {
                        let b = spawn_bar(r, f, 294.0, 18.0, SHIELD_COL, "SCHILD");
                        self.bars.push(b);
                    })
                    .id();
                self.e.push(row); // 23 shield row
                let hb = spawn_bar(s, f, 294.0, 18.0, rgba(255, 90, 110, 0.88), "HÜLLE");
                self.bars.push(hb);
            })
            .id();
        self.e.push(tgt); // 19 — pushed after its children (indices fixed in finish())

        // --- top centre: objective, hostiles, timer, autopilot hint, comm box ---
        p.spawn(Node {
            position_type: PositionType::Absolute,
            left: px(0.0),
            right: px(0.0),
            top: px(20.0),
            flex_direction: FlexDirection::Column,
            align_items: AlignItems::Center,
            row_gap: px(6.0),
            ..default()
        })
        .with_children(|c| {
            c.spawn(Node { align_items: AlignItems::Center, column_gap: px(12.0), ..default() }).with_children(|r| {
                let line = || (Node { width: px(60.0), height: px(1.0), ..default() }, BackgroundColor(DIM));
                let l = r.spawn(line()).id();
                self.e.push(r.spawn(label(&f.display, 16.0, INK, 2.5, "")).id()); // 24 objective
                let rr = r.spawn(line()).id();
                self.e.extend([l, rr]); // 25, 26
            });
            c.spawn(Node { column_gap: px(28.0), ..default() }).with_children(|r| {
                self.e.push(r.spawn(label(&f.bold, 18.0, RED, 2.0, "")).id()); // 27 hostiles
                self.e.push(r.spawn(label(&f.bold, 18.0, AMBER, 2.0, "")).id()); // 28 timer
            });
            let hint = c
                .spawn((
                    Node { padding: UiRect::axes(px(14.0), px(5.0)), border: UiRect::all(px(1.0)), ..default() },
                    BackgroundColor(rgba(120, 80, 10, 0.5)),
                    BorderColor::all(AMBER),
                    BoxShadow::new(rgba(255, 200, 87, 0.5), px(0.0), px(0.0), px(0.0), px(12.0)),
                    Visibility::Hidden,
                ))
                .with_children(|h| {
                    h.spawn(label(&f.display, 13.0, rgba(255, 226, 166, 1.0), 2.5, "J: AUTOPILOT"));
                })
                .id();
            self.e.push(hint); // 29

            // comm box
            let mut ids = [Entity::PLACEHOLDER; 8];
            let comm = c
                .spawn((
                    Node {
                        width: px(680.0),
                        margin: UiRect::top(px(10.0)),
                        padding: UiRect::new(px(8.0), px(16.0), px(8.0), px(8.0)),
                        column_gap: px(14.0),
                        align_items: AlignItems::Center,
                        border: UiRect::all(px(1.0)),
                        ..default()
                    },
                    BackgroundColor(rgba(6, 14, 24, 0.78)),
                    BorderColor::all(LINE),
                    Visibility::Hidden,
                ))
                .with_children(|cb| {
                    corner_accents(cb, CYAN, 8.0, 2.0);
                    ids[0] = cb
                        .spawn((
                            Node {
                                width: px(68.0),
                                height: px(68.0),
                                flex_shrink: 0.0,
                                border: UiRect::all(px(1.5)),
                                align_items: AlignItems::Center,
                                justify_content: JustifyContent::Center,
                                ..default()
                            },
                            BorderColor::all(CYAN),
                            BackgroundColor(rgba(127, 214, 255, 0.12)),
                        ))
                        .with_children(|pp| {
                            ids[1] = pp.spawn(label(&f.display, 22.0, CYAN, 1.0, "")).id();
                        })
                        .id();
                    cb.spawn(Node { flex_direction: FlexDirection::Column, flex_grow: 1.0, flex_shrink: 1.0, row_gap: px(3.0), ..default() }).with_children(|col| {
                        col.spawn(Node { justify_content: JustifyContent::SpaceBetween, align_items: AlignItems::Center, ..default() }).with_children(|r| {
                            ids[2] = r.spawn(label(&f.display, 13.0, CYAN, 2.0, "")).id();
                            r.spawn(Node { align_items: AlignItems::FlexEnd, column_gap: px(2.0), height: px(12.0), ..default() }).with_children(|sig| {
                                for (i, h) in [30.0, 55.0, 80.0, 100.0].into_iter().enumerate() {
                                    ids[4 + i] = sig.spawn((Node { width: px(3.0), height: percent(h), ..default() }, BackgroundColor(CYAN))).id();
                                }
                            });
                        });
                        ids[3] = col.spawn((label(&f.semi, 21.0, rgba(240, 248, 255, 1.0), 0.3, ""), TextLayout::default())).id();
                    });
                })
                .id();
            self.e.push(comm); // 30
            self.e.extend(ids); // 31..=38
        });

        // --- radar ---
        let radar = p
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(28.0),
                    bottom: px(28.0),
                    width: px(RADAR_R * 2.0),
                    height: px(RADAR_R * 2.0),
                    border: UiRect::all(px(1.0)),
                    border_radius: BorderRadius::MAX,
                    overflow: Overflow::clip(),
                    ..default()
                },
                BackgroundColor(rgba(6, 14, 24, 0.62)),
                BorderColor::all(DIM),
            ))
            .with_children(|r| {
                let sweep = r
                    .spawn((
                        Node { position_type: PositionType::Absolute, width: percent(100.0), height: percent(100.0), border_radius: BorderRadius::MAX, ..default() },
                        BackgroundGradient::from(ConicGradient::new(
                            UiPosition::CENTER,
                            vec![
                                AngularColorStop::new(rgba(127, 214, 255, 0.0), 0.0),
                                AngularColorStop::new(rgba(127, 214, 255, 0.24), 0.9),
                                AngularColorStop::new(rgba(127, 214, 255, 0.0), 0.92),
                                AngularColorStop::new(rgba(127, 214, 255, 0.0), TAU),
                            ],
                        )),
                    ))
                    .id();
                self.e.push(sweep); // 39 (after radar root 40 below? see finish)
                let mut inner = Node {
                    position_type: PositionType::Absolute,
                    left: percent(25.0),
                    top: percent(25.0),
                    width: percent(50.0),
                    height: percent(50.0),
                    border: UiRect::all(px(1.0)),
                    border_radius: BorderRadius::MAX,
                    ..default()
                };
                r.spawn((inner.clone(), BorderColor::all(rgba(127, 214, 255, 0.22))));
                inner.left = percent(49.75);
                inner.top = percent(0.0);
                inner.width = px(1.0);
                inner.height = percent(100.0);
                inner.border = UiRect::ZERO;
                inner.border_radius = BorderRadius::ZERO;
                r.spawn((inner.clone(), BackgroundColor(rgba(127, 214, 255, 0.18))));
                inner.left = percent(0.0);
                inner.top = percent(49.75);
                inner.width = percent(100.0);
                inner.height = px(1.0);
                r.spawn((inner, BackgroundColor(rgba(127, 214, 255, 0.18))));
                // own ship
                r.spawn((
                    Node { position_type: PositionType::Absolute, left: px(RADAR_R - 3.0), top: px(RADAR_R - 3.0), width: px(6.0), height: px(6.0), ..default() },
                    BackgroundColor(CYAN),
                ));
                for _ in 0..72 {
                    let n = Node { border: UiRect::all(px(1.0)), ..abs_node(BLIP, BLIP) };
                    self.blips.push(r.spawn((n, BackgroundColor(RED), BorderColor::all(rgba(0, 0, 0, 0.8)), Visibility::Hidden)).id());
                }
            })
            .id();
        self.e.push(radar); // 40

        // --- alerts ---
        p.spawn(Node {
            position_type: PositionType::Absolute,
            left: px(0.0),
            right: px(0.0),
            top: percent(29.0),
            flex_direction: FlexDirection::Column,
            align_items: AlignItems::Center,
            row_gap: px(8.0),
            ..default()
        })
        .with_children(|a| {
            self.e.push(a.spawn((label(&f.display, 26.0, RED, 4.0, "PLASMASUCHER!"), Visibility::Hidden)).id()); // 41
            self.e.push(a.spawn((label(&f.display, 20.0, AMBER, 4.0, "SCHILDE UNTEN"), Visibility::Hidden)).id()); // 42
        });
        let dead = p
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    width: percent(100.0),
                    height: percent(100.0),
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    ..default()
                },
                BackgroundColor(rgba(40, 0, 10, 0.35)),
                Visibility::Hidden,
            ))
            .with_children(|d| {
                d.spawn(label(&f.display, 40.0, RED, 8.0, "ABGESCHOSSEN"));
            })
            .id();
        self.e.push(dead); // 43

        // banner (centre, 40 % height) with expanding lines
        let mut bl = [Entity::PLACEHOLDER; 3];
        let banner = p
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(0.0),
                    right: px(0.0),
                    top: percent(36.0),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Center,
                    row_gap: px(12.0),
                    ..default()
                },
                Visibility::Hidden,
            ))
            .with_children(|b| {
                bl[0] = b.spawn((Node { width: px(600.0), height: px(1.5), ..default() }, BackgroundColor(rgba(127, 214, 255, 0.7)))).id();
                bl[1] = b.spawn(label(&f.display, 34.0, WHITE, 5.0, "")).id();
                bl[2] = b.spawn((Node { width: px(600.0), height: px(1.5), ..default() }, BackgroundColor(rgba(127, 214, 255, 0.7)))).id();
            })
            .id();
        self.e.push(banner); // 44
        self.e.extend(bl); // 45, 46, 47

        // mission start cinematic
        let mut cl = [Entity::PLACEHOLDER; 5];
        let cine = p
            .spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: px(0.0),
                    right: px(0.0),
                    top: percent(30.0),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Center,
                    row_gap: px(14.0),
                    ..default()
                },
                Visibility::Hidden,
            ))
            .with_children(|b| {
                cl[0] = b.spawn(label(&f.bold, 22.0, ORANGE, 9.0, "")).id();
                cl[1] = b
                    .spawn((
                        Node { width: px(860.0), height: px(1.5), ..default() },
                        BackgroundGradient::from(LinearGradient::to_right(vec![
                            ColorStop::auto(rgba(127, 214, 255, 0.0)),
                            ColorStop::auto(CYAN),
                            ColorStop::auto(rgba(127, 214, 255, 0.0)),
                        ])),
                    ))
                    .id();
                cl[2] = b.spawn(label(&f.display, 76.0, WHITE, 10.0, "")).id();
                cl[3] = b
                    .spawn((
                        Node { width: px(860.0), height: px(1.5), ..default() },
                        BackgroundGradient::from(LinearGradient::to_right(vec![
                            ColorStop::auto(rgba(127, 214, 255, 0.0)),
                            ColorStop::auto(CYAN),
                            ColorStop::auto(rgba(127, 214, 255, 0.0)),
                        ])),
                    ))
                    .id();
                cl[4] = b.spawn(label(&f.semi, 22.0, MUTED, 6.0, "")).id();
            })
            .id();
        self.e.push(cine); // 48
        self.e.extend(cl); // 49..=53
    }

    fn finish(self, root: Entity) -> HudIds {
        let e = &self.e;
        let b = &self.bars;
        let t = &self.tags;
        HudIds {
            root,
            vignette: e[0],
            nav: e[1],
            brackets: e[2],
            bracket_corners: [e[3], e[4], e[5], e[6]],
            lock_ring: e[7],
            lock_diamond: e[8],
            lead: e[9],
            reticle: e[10],
            arrows: [e[11], e[12]],
            speed: e[14],
            neutron: e[15],
            thr_fill: e[16],
            thr_want: e[17],
            thr_val: e[18],
            tgt_dist: e[19],
            tgt_name: e[20],
            tgt_class: e[21],
            tgt_shield_row: e[22],
            tgt_panel: e[23],
            obj_text: e[24],
            obj_lines: [e[25], e[26]],
            hostiles: e[27],
            timer: e[28],
            auto_hint: e[29],
            comm: e[30],
            comm_portrait: e[31],
            comm_initials: e[32],
            comm_name: e[33],
            comm_text: e[34],
            comm_bars: [e[35], e[36], e[37], e[38]],
            radar_sweep: e[39],
            radar: e[40],
            warn_seeker: e[41],
            warn_shield: e[42],
            dead: e[43],
            banner: e[44],
            banner_lines: [e[45], e[47]],
            banner_text: e[46],
            cine: e[48],
            cine_kicker: e[49],
            cine_lines: [e[50], e[52]],
            cine_title: e[51],
            cine_sub: e[53],
            shield: b[0],
            hull: b[1],
            boost: b[2],
            tgt_shield: b[3],
            tgt_hull: b[4],
            nav_tag: t[0],
            tgt_tag: t[1],
            lock_tag: t[2],
            lead_tag: t[3],
            reticle_parts: self.reticle_parts,
            lead_parts: self.lead_parts,
            blips: self.blips,
            markers: self.markers,
            foes: self.foes,
            friends: self.friends,
            flare: self.flare,
        }
    }
}

const RADAR_R: f32 = 96.0;
const BLIP: f32 = 8.0;

// ---------- per-frame updates ----------

fn start_cine(data: Res<GameData>, progress: Res<Progress>, mut anim: ResMut<HudAnim>) {
    let m = data.mission(progress.current);
    let no = progress.current.min(data.campaign.missions.len().saturating_sub(1)) + 1;
    anim.cine = [
        format!("MISSION {no:02} // {}", m.sector.to_uppercase()),
        display_safe(&m.title),
        m.objectives.first().cloned().unwrap_or_default().to_uppercase(),
    ];
    anim.cine_t = 0.0;
}

/// Status panel, target panel and objective line.
#[allow(clippy::too_many_arguments)]
fn hud_status(
    time: Res<Time>,
    paused: Res<Paused>,
    ids: Res<HudIds>,
    status: Res<MissionStatus>,
    cfg: Res<HudConfig>,
    mut anim: ResMut<HudAnim>,
    player: Query<(&GlobalTransform, &Ship, &Player)>,
    targets: Query<(&GlobalTransform, &Ship, Has<Dying>), Without<Player>>,
    mut ui: Ui,
    mut buf: Local<String>,
) {
    if !paused.0 {
        anim.time += time.delta_secs();
    }
    let t = anim.time;
    ui.show(ids.root, cfg.visible);
    let Some((ptf, ship, pl)) = player.iter().next() else { return };

    // own ship
    let sk = if ship.max_shield > 0.0 { (ship.shield / ship.max_shield).clamp(0.0, 1.0) } else { 0.0 };
    let hk = (ship.hp / ship.max_hp.max(1.0)).clamp(0.0, 1.0);
    bar(&mut ui, ids.shield, sk, None, &mut buf);
    let low = hk < 0.3;
    let hull_col = if low && (t * 6.0).sin() > -0.4 { HULL_LOW } else if low { rgba(150, 30, 45, 0.9) } else { HULL_OK };
    bar(&mut ui, ids.hull, hk, Some(hull_col), &mut buf);
    let (blabel, bcol, bk) = if pl.impulse {
        ("IMPULSANTRIEB", IMPULSE_COL, 1.0)
    } else if pl.impulse_prog > 0.0 {
        ("IMPULS", IMPULSE_COL, pl.impulse_prog)
    } else {
        ("BOOST", BOOST_COL, pl.energy)
    };
    ui.text(ids.boost.label, blabel);
    ui.bg(ids.boost.fill, bcol);
    ui.width_pct(ids.boost.fill, bk);
    buf.clear();
    if !pl.impulse {
        let _ = write!(buf, "{} %", (bk * 100.0).round() as i32);
    }
    ui.text(ids.boost.value, &buf);
    speed_text(&mut buf, ship.speed);
    ui.text(ids.speed, &buf);
    ui.text_color(ids.speed, if pl.impulse { CYAN } else if pl.boosting { AMBER } else { WHITE });
    buf.clear();
    let _ = write!(buf, "NEUTRON {}", ship.missiles);
    ui.text(ids.neutron, &buf);
    ui.text_color(ids.neutron, if ship.missiles == 0 { MUTED } else { AMBER });
    ui.width_pct(ids.thr_fill, pl.throttle);
    // the caret on the fill's scale: the throttle setting the speed the ship heads for corresponds to
    // (web: want = speed * (0.15 + throttle * 0.85)); boost pins it to the end
    let cruise = ship.def.speed.max(1.0);
    let want_thr = ((pl.want_speed / cruise - 0.15) / 0.85).clamp(0.0, 1.0);
    if let Ok(mut n) = ui.nodes.get_mut(ids.thr_want) {
        let want = percent((want_thr * 100.0).round() - 1.0);
        if n.left != want {
            n.left = want;
        }
    }
    buf.clear();
    let _ = write!(buf, "{} %", (pl.throttle * 100.0).round() as i32);
    ui.text(ids.thr_val, &buf);

    // target panel
    let target = pl.target.and_then(|e| targets.get(e).ok().map(|v| (e, v))).filter(|(_, (_, _, dying))| !dying);
    if target.map(|(e, _)| e) != anim.target {
        anim.target = target.map(|(e, _)| e);
        anim.target_t = t;
        anim.target_name = target.map(|(_, (_, s, _))| display_safe(&s.name)).unwrap_or_default();
    }
    ui.show(ids.tgt_panel, target.is_some());
    if let Some((_, (ttf, ts, _))) = target {
        let col = match ts.team {
            Team::Aszendenz => RED,
            Team::Union => GREEN,
            Team::Neutral => NEUTRAL,
        };
        decoded(&mut buf, &anim.target_name, t - anim.target_t, 40.0);
        ui.text(ids.tgt_name, &buf);
        ui.text_color(ids.tgt_name, col);
        buf.clear();
        buf.push_str(if ts.capital() { "KAPITALSCHIFF" } else { "JÄGER" });
        buf.push_str(match ts.team {
            Team::Aszendenz => " · ASZENDENZ",
            Team::Union => " · UNION",
            Team::Neutral => " · NEUTRAL",
        });
        ui.text(ids.tgt_class, &buf);
        buf.clear();
        dist_text(&mut buf, ttf.translation().distance(ptf.translation()));
        ui.text(ids.tgt_dist, &buf);
        ui.show(ids.tgt_shield_row, ts.max_shield > 0.0);
        if ts.max_shield > 0.0 {
            bar(&mut ui, ids.tgt_shield, ts.shield / ts.max_shield, None, &mut buf);
        }
        bar(&mut ui, ids.tgt_hull, ts.hp / ts.max_hp.max(1.0), None, &mut buf);
    }

    // objective, hostiles, timer, autopilot
    if status.objective != anim.obj_src {
        // decode again only when the objective itself changes, not its " · 2/4" counter
        let key = |s: &str| s.split(" · ").next().unwrap_or("").to_string();
        if key(&status.objective) != key(&anim.obj_src) {
            anim.obj_t = t;
        }
        anim.obj_src.clone_from(&status.objective);
        anim.obj_upper = display_safe(&status.objective);
    }
    let obj_empty = anim.obj_upper.is_empty();
    decoded(&mut buf, &anim.obj_upper, t - anim.obj_t, 45.0);
    ui.text(ids.obj_text, &buf);
    let grow = ((t - anim.obj_t) / 0.5).clamp(0.0, 1.0);
    for e in ids.obj_lines {
        ui.size(e, 10.0 + 50.0 * grow, 1.0);
        ui.show(e, !obj_empty);
    }
    buf.clear();
    if status.hostiles > 0 {
        let _ = write!(buf, "FEINDE: {}", status.hostiles);
    }
    ui.text(ids.hostiles, &buf);
    buf.clear();
    if let Some(tm) = status.timer {
        let s = tm.max(0.0).ceil() as i32;
        let _ = write!(buf, "ZEIT {:02}:{:02}", s / 60, s % 60);
        ui.text_color(ids.timer, if tm < 30.0 && (t * 4.0).sin() > 0.0 { RED } else { AMBER });
    }
    ui.text(ids.timer, &buf);
    ui.show(ids.auto_hint, status.auto_available && status.ended.is_none());
    if let Ok(mut sh) = ui.xf.get_mut(ids.auto_hint) {
        let k = 1.0 + 0.04 * (t * 5.0).sin().max(0.0);
        let want = UiTransform { scale: Vec2::splat((k * 100.0).round() / 100.0), ..UiTransform::IDENTITY };
        if *sh != want {
            *sh = want;
        }
    }
}

/// Fill a bar and its percentage text; `color` overrides the fill colour.
fn bar(ui: &mut Ui, b: Bar, k: f32, color: Option<Color>, buf: &mut String) {
    let k = k.clamp(0.0, 1.0);
    ui.width_pct(b.fill, k);
    if let Some(c) = color {
        ui.bg(b.fill, c);
    }
    buf.clear();
    let _ = write!(buf, "{} %", (k * 100.0).round() as i32);
    ui.text(b.value, buf);
}

/// Comm box: radio lines one after another, decoded in, held for a time that depends on their length.
#[allow(clippy::too_many_arguments)]
fn hud_comm(
    time: Res<Time>,
    paused: Res<Paused>,
    ids: Res<HudIds>,
    data: Res<GameData>,
    progress: Res<Progress>,
    anim: Res<HudAnim>,
    mut msgs: MessageReader<CommMsg>,
    mut q: ResMut<CommQueue>,
    mut ui: Ui,
    mut buf: Local<String>,
) {
    for m in msgs.read() {
        // full: the new line is dropped (web app.js: `if (commQ.length < 6) commQ.push(...)`), so kill chatter
        // never pushes queued story lines out
        if q.queue.len() >= 6 {
            continue;
        }
        // unknown speakers are the controller (web: CHARS[who] || CHARS.erz)
        let who = if data.campaign.chars.contains_key(&m.who) { m.who.as_str() } else { "erz" };
        let ch = data.campaign.chars.get(who);
        let name = display_safe(&data.speaker(who));
        let initials = ch.map(|c| c.short.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| name.chars().take(2).collect());
        let text = fill_callsign(&m.text, &progress.callsign);
        let chars = text.chars().count();
        let dur = 2.4 + chars as f32 * 0.045;
        q.queue.push_back(CommLine { name, initials, color: char_color(&data, who), text, chars, dur });
    }
    if paused.0 {
        return;
    }
    let q = &mut *q;
    q.t += time.delta_secs();
    // next line when the current one ran out; hold the radio while the mission title is on screen
    if q.current.as_ref().is_none_or(|c| q.t >= c.dur) {
        q.current = if anim.cine_t < CINE_DUR - 0.4 { None } else { q.queue.pop_front() };
        q.t = 0.0;
        q.fresh = true;
    }
    let Some(c) = &q.current else {
        ui.show(ids.comm, false);
        return;
    };
    ui.show(ids.comm, true);
    if q.fresh {
        q.fresh = false;
        ui.text(ids.comm_name, &c.name);
        ui.text_color(ids.comm_name, c.color);
        ui.text(ids.comm_initials, &c.initials);
        ui.text_color(ids.comm_initials, c.color);
        ui.border(ids.comm_portrait, c.color);
        ui.bg(ids.comm_portrait, with_alpha(c.color, 0.14));
    }
    decoded(&mut buf, &c.text, q.t, 75.0);
    ui.text(ids.comm_text, &buf);
    // holographic unfold (from a bright line) and fold away at the end
    let open = (q.t / 0.18).min(1.0);
    let close = ((c.dur - q.t) / 0.15).clamp(0.0, 1.0);
    let k = (open.min(close) * 50.0).round() / 50.0;
    if let Ok(mut tf) = ui.xf.get_mut(ids.comm) {
        let want = UiTransform { scale: Vec2::new(1.0, k.max(0.04)), ..UiTransform::IDENTITY };
        if *tf != want {
            *tf = want;
        }
    }
    // signal bars flicker while the text decodes
    let talking = q.t * 75.0 < c.chars as f32;
    for (i, e) in ids.comm_bars.into_iter().enumerate() {
        let a = if talking { 0.35 + 0.65 * ((q.t * 10.0 + i as f32 * 1.7).sin() * 0.5 + 0.5) } else { 0.6 };
        ui.bg(e, with_alpha(c.color, (a * 10.0).round() / 10.0));
    }
}

const CINE_DUR: f32 = 3.9;

/// Warnings, death, banners, damage vignette and the mission title cinematic.
#[allow(clippy::too_many_arguments)]
fn hud_alerts(
    time: Res<Time>,
    paused: Res<Paused>,
    ids: Res<HudIds>,
    status: Res<MissionStatus>,
    seeker: Option<Res<SeekerWarning>>,
    mut anim: ResMut<HudAnim>,
    mut banners: MessageReader<HudBanner>,
    mut damage: MessageReader<DamageMsg>,
    player: Query<(Entity, &Ship, Has<Dying>), With<Player>>,
    mut ui: Ui,
    mut buf: Local<String>,
) {
    let dt = if paused.0 { 0.0 } else { time.delta_secs() };
    let t = anim.time;
    let pl = player.iter().next();
    let dead = pl.is_none_or(|p| p.2);
    let blink = |hz: f32| (t * hz).sin() > -0.2;

    ui.show(ids.warn_seeker, !dead && seeker.is_some_and(|s| s.0) && blink(16.0));
    let shields_down = pl.is_some_and(|(_, s, _)| s.max_shield > 0.0 && s.shield <= s.max_shield * 0.01);
    ui.show(ids.warn_shield, !dead && shields_down && blink(5.0));
    ui.show(ids.dead, dead && status.ended.is_none());

    // damage vignette
    if let Some((pe, ..)) = pl {
        for d in damage.read() {
            if d.target == pe {
                anim.hurt = (anim.hurt + d.amount / 60.0).min(0.6);
            }
        }
    } else {
        damage.clear();
    }
    anim.hurt = (anim.hurt - dt * 0.9).max(0.0);
    let q = (anim.hurt * 25.0).round() as i32;
    if q != anim.hurt_q {
        anim.hurt_q = q;
        ui.show(ids.vignette, q > 0);
        if let Ok(mut g) = ui.grad.get_mut(ids.vignette) {
            g.0 = vec![
                RadialGradient::new(
                    UiPosition::CENTER,
                    RadialGradientShape::FarthestCorner,
                    vec![ColorStop::percent(rgba(255, 40, 60, 0.0), 45.0), ColorStop::percent(rgba(255, 40, 60, q as f32 / 25.0), 100.0)],
                )
                .into(),
            ];
        }
    }

    // banners: a message, or the mission result
    for b in banners.read() {
        // Orbitron (display font) has no '·' or '„' and the banner is set in capitals
        anim.banner = display_safe(&b.0);
        anim.banner_t = 0.0;
    }
    if let Some(end) = &status.ended {
        let s = if end.win { "MISSION ERFOLGREICH" } else { "MISSION GESCHEITERT" };
        if anim.banner != s {
            anim.banner = s.to_string();
            anim.banner_t = 0.0;
        }
        ui.text_color(ids.banner_text, if end.win { GREEN } else { RED });
    } else {
        ui.text_color(ids.banner_text, WHITE);
    }
    anim.banner_t += dt;
    let showing = !anim.banner.is_empty() && (anim.banner_t < 3.2 || status.ended.is_some());
    ui.show(ids.banner, showing);
    if showing {
        decoded(&mut buf, &anim.banner, anim.banner_t, 50.0);
        ui.text(ids.banner_text, &buf);
        let e = (anim.banner_t / 0.4).min(1.0);
        let w = (anim.banner.chars().count() as f32 * 30.0 + 60.0) * e;
        for l in ids.banner_lines {
            ui.size(l, w, 1.5);
        }
    }

    // mission title cinematic (web: #cine): tracking-in title, lines, then fade out
    if anim.cine_t < CINE_DUR {
        anim.cine_t += dt;
        let ct = anim.cine_t;
        ui.show(ids.cine, ct < CINE_DUR && !paused.0);
        decoded(&mut buf, &anim.cine[0], ct, 60.0);
        ui.text(ids.cine_kicker, &buf);
        decoded(&mut buf, &anim.cine[1], ct, 22.0);
        ui.text(ids.cine_title, &buf);
        decoded(&mut buf, &anim.cine[2], ct - 0.7, 50.0);
        ui.text(ids.cine_sub, &buf);
        let k = (ct / 3.6).min(1.0);
        let ease = 1.0 - (1.0 - k).powi(3);
        ui.letter_spacing(ids.cine_title, 38.0 - 28.0 * ease);
        let line = ((ct / 1.1).min(1.0) * 860.0).max(1.0);
        for l in ids.cine_lines {
            ui.size(l, line, 1.5);
        }
        let out = ((CINE_DUR - ct) / 0.6).clamp(0.0, 1.0);
        if let Ok(mut tf) = ui.xf.get_mut(ids.cine) {
            let want = UiTransform { scale: Vec2::splat(1.0 + (1.0 - out) * 0.04), ..UiTransform::IDENTITY };
            if *tf != want {
                *tf = want;
            }
        }
        for (e, c) in [(ids.cine_kicker, ORANGE), (ids.cine_title, WHITE), (ids.cine_sub, MUTED)] {
            ui.text_color(e, with_alpha(c, (out * 20.0).round() / 20.0));
        }
    }
}

/// Camera projection onto the reference canvas.
struct Proj {
    view: Mat4,
    clip: Mat4,
    size: Vec2,
}

impl Proj {
    /// canvas position, None when behind the camera
    fn project(&self, p: Vec3) -> Option<Vec2> {
        let v = self.view.transform_point3(p);
        if v.z > -0.5 {
            return None;
        }
        let c = self.clip * v.extend(1.0);
        let n = c.truncate() / c.w;
        Some(Vec2::new((n.x * 0.5 + 0.5) * self.size.x, (0.5 - n.y * 0.5) * self.size.y))
    }
    fn on_screen(&self, q: Vec2, margin: f32) -> bool {
        q.x > margin && q.y > margin && q.x < self.size.x - margin && q.y < self.size.y - margin
    }
    /// screen-space direction angle (y down) towards a world point, also for points behind the camera
    fn angle(&self, p: Vec3) -> f32 {
        let v = self.view.transform_point3(p);
        (-v.y).atan2(v.x)
    }
}

/// Everything projected from the world: reticle, lead, brackets, lock, nav, markers, arrows, radar, flare.
#[allow(clippy::too_many_arguments)]
fn hud_world(
    ids: Res<HudIds>,
    settings: Res<Settings>,
    cfg: Res<HudConfig>,
    status: Res<MissionStatus>,
    sky: Option<Res<SkyInfo>>,
    scale: Res<UiScale>,
    mut anim: ResMut<HudAnim>,
    cam: Query<(&Camera, &GlobalTransform, &Projection), With<MainCamera>>,
    player: Query<(&GlobalTransform, &Ship, &Player, Option<&PlayerAim>), Without<Dying>>,
    ships: Query<(Entity, &GlobalTransform, &Ship, Option<&Hittable>), (Without<Player>, Without<Dying>)>,
    mut ui: Ui,
    mut buf: Local<String>,
) {
    let t = anim.time;
    let Ok((camera, cam_tf, projection)) = cam.single() else { return };
    let Some(vp) = camera.logical_viewport_size() else { return };
    let pr = Proj { view: cam_tf.affine().inverse().into(), clip: camera.clip_from_view(), size: vp / scale.0.max(0.01) };
    let (w, h) = (pr.size.x, pr.size.y);
    let fov = match projection {
        Projection::Perspective(p) => p.fov,
        _ => 1.0,
    };
    let px_per_m = h * 0.5 / (fov * 0.5).tan();
    let cockpit = settings.view == View::Cockpit;

    // radar placement follows the view (bottom left in the chase view, under the status panel in the cockpit)
    if anim.view != Some(settings.view) {
        anim.view = Some(settings.view);
        if let Ok(mut n) = ui.nodes.get_mut(ids.radar) {
            if cockpit {
                n.top = px(300.0);
                n.bottom = Val::Auto;
            } else {
                n.top = Val::Auto;
                n.bottom = px(28.0);
            }
        }
    }
    ui.show(ids.radar, !cockpit || cfg.radar_in_cockpit);

    let Some((ptf, pship, pl, aim)) = player.iter().next() else {
        for e in [ids.reticle, ids.lead, ids.brackets, ids.lock_ring, ids.lock_diamond, ids.nav, ids.arrows[0], ids.arrows[1]] {
            ui.show(e, false);
        }
        for tg in [ids.lead_tag, ids.tgt_tag, ids.lock_tag, ids.nav_tag] {
            ui.show(tg.root, false);
        }
        for &(sq, tg) in &ids.markers {
            ui.show(sq, false);
            ui.show(tg.root, false);
        }
        hide_pool(&mut ui, &ids.foes, 0);
        hide_pool(&mut ui, &ids.friends, 0);
        hide_pool(&mut ui, &ids.blips, 0);
        return;
    };
    let ppos = ptf.translation();
    let prot = ptf.rotation();
    let pfwd = prot * Vec3::Z;
    let center = Vec2::new(w * 0.5, h * 0.5);

    // reticle (where the guns point)
    let locked = aim.is_some_and(|a| a.locked);
    let ret = pr.project(ppos + pfwd * 800.0);
    ui.show(ids.reticle, ret.is_some());
    let ret_p = ret.unwrap_or(center);
    if ret.is_some() {
        ui.center(ids.reticle, ret_p, Vec2::splat(60.0), if locked { t * 3.0 } else { 0.0 }, 1.0);
        ui.tint(&ids.reticle_parts, if locked { GREEN } else { CYAN });
    }

    // target: brackets, distance, lead pipper, seeker lock
    let target = pl.target.and_then(|e| ships.get(e).ok());
    if let Some((_, ttf, ts, hit)) = target {
        let tp = ttf.translation();
        let d = tp.distance(ppos).max(1.0);
        let q = pr.project(tp).filter(|q| pr.on_screen(*q, 0.0));
        let radius = hit.map_or(ts.radius(), |h| h.radius).max(ts.radius());
        let r = (radius * 1.2 / d * px_per_m).clamp(18.0, 160.0);
        if let Some(q) = q {
            let lock_in = ((t - anim.target_t) / 0.35).clamp(0.0, 1.0);
            let size = 2.0 * r;
            ui.show(ids.brackets, true);
            ui.size(ids.brackets, size, size);
            ui.center(ids.brackets, q, Vec2::splat(size.round()), (1.0 - lock_in) * 1.2, 2.2 - lock_in * 1.2);
            let col = match ts.team {
                Team::Aszendenz => RED,
                Team::Union => GREEN,
                Team::Neutral => NEUTRAL,
            };
            for c in ids.bracket_corners {
                ui.border(c, col);
            }
            buf.clear();
            dist_text(&mut buf, d);
            ui.tag(ids.tgt_tag, q - Vec2::new(0.0, r + 28.0), &buf, col);
            ui.show(ids.arrows[0], false);
        } else {
            ui.show(ids.brackets, false);
            ui.show(ids.tgt_tag.root, false);
            arrow(&mut ui, &pr, ids.arrows[0], tp, cockpit);
        }

        // lead pipper (fighters within gun range)
        let lead = aim.and_then(|a| a.lead).filter(|_| !ts.capital() && d < 1400.0).and_then(|l| pr.project(l));
        ui.show(ids.lead, lead.is_some());
        if let Some(l) = lead {
            let col = if locked { GREEN } else { AMBER };
            ui.center(ids.lead, l, Vec2::splat(56.0), 0.0, 1.0);
            ui.tint(&ids.lead_parts[..3], col);
            for &e in &ids.lead_parts[3..] {
                ui.show(e, locked);
            }
            if locked {
                ui.tag(ids.lead_tag, l + Vec2::new(0.0, 34.0), "TREFFERLÖSUNG", GREEN);
            } else {
                ui.show(ids.lead_tag.root, false);
            }
        } else {
            ui.show(ids.lead_tag.root, false);
        }

        // neutron seeker lock: ring travels from the reticle onto the target, then a spinning diamond
        let lock = pl.lock.clamp(0.0, 1.0);
        match q.filter(|_| lock > 0.0 && pship.missiles > 0) {
            Some(q) if lock >= 1.0 => {
                let rr = (r + 16.0).max(36.0);
                let col = if (t * 18.0).sin() > -0.3 { RED } else { WHITE };
                ui.show(ids.lock_ring, false);
                ui.show(ids.lock_diamond, true);
                ui.border(ids.lock_diamond, col);
                ui.center(ids.lock_diamond, q, Vec2::splat(60.0), FRAC_PI_4 + t * 2.0, rr * 1.414 / 60.0);
                ui.tag(ids.lock_tag, q - Vec2::new(0.0, r.max(rr) + 52.0), "NEUTRON AUFGESCHALTET", col);
            }
            Some(q) => {
                let k = lock.powf(0.7);
                let s = ret_p.lerp(q, k);
                ui.show(ids.lock_diamond, false);
                ui.show(ids.lock_ring, true);
                ui.border(ids.lock_ring, AMBER);
                let rr = 26.0 - k * 8.0;
                ui.center(ids.lock_ring, s, Vec2::splat(52.0), 0.0, rr / 26.0);
                buf.clear();
                let _ = write!(buf, "ERFASSUNG {} %", (lock * 100.0).round() as i32);
                ui.tag(ids.lock_tag, s + Vec2::new(0.0, rr + 10.0), &buf, AMBER);
            }
            None => {
                ui.show(ids.lock_ring, false);
                ui.show(ids.lock_diamond, false);
                ui.show(ids.lock_tag.root, false);
            }
        }
    } else {
        for e in [ids.brackets, ids.lead, ids.lock_ring, ids.lock_diamond, ids.arrows[0]] {
            ui.show(e, false);
        }
        for tg in [ids.tgt_tag, ids.lead_tag, ids.lock_tag] {
            ui.show(tg.root, false);
        }
    }

    // nav point
    let mut nav_arrow = false;
    if let Some(nav) = status.nav_pos {
        let d = nav.distance(ppos);
        match pr.project(nav).filter(|q| pr.on_screen(*q, 0.0)) {
            Some(q) => {
                let pulse = 1.0 + (t * 4.0).sin() * 0.12;
                ui.show(ids.nav, true);
                ui.center(ids.nav, q, Vec2::splat(24.0), FRAC_PI_4, pulse);
                buf.clear();
                buf.extend(status.nav_name.chars().flat_map(char::to_uppercase));
                buf.push_str(" · ");
                dist_text(&mut buf, d);
                ui.tag(ids.nav_tag, q + Vec2::new(0.0, 22.0), &buf, AMBER);
            }
            None => {
                ui.show(ids.nav, false);
                ui.show(ids.nav_tag.root, false);
                if target.is_none() {
                    arrow(&mut ui, &pr, ids.arrows[1], nav, cockpit);
                    nav_arrow = true;
                }
            }
        }
    } else {
        ui.show(ids.nav, false);
        ui.show(ids.nav_tag.root, false);
    }
    if !nav_arrow {
        ui.show(ids.arrows[1], false);
    }

    // objective markers (pickups, scan zones, courier, docking)
    for (i, &(sq, tg)) in ids.markers.iter().enumerate() {
        let Some((pos, name, rgb)) = status.markers.get(i) else {
            ui.show(sq, false);
            ui.show(tg.root, false);
            continue;
        };
        let col = Color::srgb(rgb[0], rgb[1], rgb[2]);
        match pr.project(*pos).filter(|q| pr.on_screen(*q, 0.0)) {
            Some(q) => {
                ui.show(sq, true);
                ui.border(sq, col);
                ui.center(sq, q, Vec2::splat(22.0), t * 1.5, 1.0 + (t * 5.0).sin() * 0.15);
                buf.clear();
                buf.push_str(name);
                buf.push_str(" · ");
                dist_text(&mut buf, pos.distance(ppos));
                ui.tag(tg, q + Vec2::new(0.0, 22.0), &buf, col);
            }
            None => {
                ui.show(sq, false);
                ui.show(tg.root, false);
            }
        }
    }

    // other ships: foe diamonds, friendly circles
    let (mut nf, mut nfr) = (0, 0);
    for (e, tf, s, _) in &ships {
        if Some(e) == pl.target {
            continue;
        }
        let Some(q) = pr.project(tf.translation()).filter(|q| pr.on_screen(*q, 8.0)) else { continue };
        if s.team == Team::Aszendenz {
            if let Some(&m) = ids.foes.get(nf) {
                ui.show(m, true);
                ui.center(m, q, Vec2::splat(13.0), FRAC_PI_4, 1.0);
                nf += 1;
            }
        } else if let Some(&m) = ids.friends.get(nfr) {
            ui.show(m, true);
            ui.border(m, if s.team == Team::Union { with_alpha(GREEN, 0.8) } else { with_alpha(NEUTRAL, 0.8) });
            ui.center(m, q, Vec2::splat(14.0), 0.0, 1.0);
            nfr += 1;
        }
    }
    hide_pool(&mut ui, &ids.foes, nf);
    hide_pool(&mut ui, &ids.friends, nfr);

    // radar: angle off the nose maps to the distance from the centre (sphere radar)
    if !cockpit || cfg.radar_in_cockpit {
        ui.place(ids.radar_sweep, Vec2::ZERO, (t * 2.0) % TAU, 1.0);
        let inv = prot.inverse();
        let blip = |p: Vec3| -> Vec2 {
            let v = inv * (p - ppos);
            let d = v.length().max(1e-3);
            let ang = (v.z / d).clamp(-1.0, 1.0).acos() / PI;
            let l = Vec2::new(v.x, v.y).length().max(1e-4);
            Vec2::new(RADAR_R - v.x / l * ang * RADAR_R, RADAR_R - v.y / l * ang * RADAR_R)
        };
        let mut n = 0;
        let mut put = |ui: &mut Ui, pos: Vec2, col: Color, rot: f32, scale: f32, outline: bool| {
            if let Some(&b) = ids.blips.get(n) {
                ui.show(b, true);
                ui.bg(b, col);
                ui.border(b, if outline { WHITE } else { rgba(0, 0, 0, 0.8) });
                ui.center(b, pos, Vec2::splat(BLIP), rot, scale);
                n += 1;
            }
        };
        if let Some(nav) = status.nav_pos {
            put(&mut ui, blip(nav), AMBER, FRAC_PI_4, 1.1, false);
        }
        for (pos, _, rgb) in &status.markers {
            put(&mut ui, blip(*pos), Color::srgb(rgb[0], rgb[1], rgb[2]), 0.0, 0.9, false);
        }
        for (e, tf, s, _) in &ships {
            let is_t = Some(e) == pl.target;
            let col = if is_t {
                WHITE
            } else {
                match s.team {
                    Team::Aszendenz => RED,
                    Team::Union => GREEN,
                    Team::Neutral => NEUTRAL,
                }
            };
            let (rot, sc) = match (s.team, s.capital()) {
                (_, true) => (0.0, 1.6),
                (Team::Aszendenz, _) => (FRAC_PI_4, 1.0),
                _ => (0.0, 0.85),
            };
            put(&mut ui, blip(tf.translation()), col, rot, sc, s.capital() || is_t);
        }
        hide_pool(&mut ui, &ids.blips, n);
    } else {
        hide_pool(&mut ui, &ids.blips, 0);
    }

    // sun lens flare (web: ghosts along the line through the screen centre, plus an anamorphic streak)
    let flare = sky.as_deref().and_then(|s| {
        let q = pr.project(cam_tf.translation() + s.sun_dir * 20000.0)?;
        let off = ((q.x - w * 0.5).abs() / (w * 0.75)).max((q.y - h * 0.5).abs() / (h * 0.75)) - 0.6;
        let k = (1.0 - off.max(0.0) * 2.5).clamp(0.0, 1.0) * s.sun_visible.clamp(0.0, 1.0);
        (k > 0.01).then_some((q, k))
    });
    let kq = flare.map_or(0, |(_, k)| (k * 12.0).round() as i32);
    const GHOSTS: [(f32, f32, [u8; 3], f32); 6] = [
        (0.0, 150.0, [255, 240, 210], 0.05),
        (0.35, 26.0, [120, 200, 255], 0.035),
        (0.6, 56.0, [255, 160, 90], 0.02),
        (0.85, 16.0, [170, 255, 200], 0.04),
        (1.25, 90.0, [90, 140, 255], 0.015),
        (1.6, 36.0, [255, 120, 200], 0.025),
    ];
    if kq != anim.flare_q {
        anim.flare_q = kq;
        let k = kq as f32 / 12.0;
        for (i, (tpos, _, c, a)) in GHOSTS.iter().enumerate() {
            let e = ids.flare[i];
            ui.show(e, kq > 0);
            if let Ok(mut g) = ui.grad.get_mut(e) {
                g.0 = vec![
                    RadialGradient::new(
                        UiPosition::CENTER,
                        RadialGradientShape::ClosestSide,
                        vec![
                            ColorStop::percent(rgba(c[0], c[1], c[2], a * k), 0.0),
                            ColorStop::percent(rgba(c[0], c[1], c[2], a * k * 0.5), if *tpos == 0.0 { 40.0 } else { 70.0 }),
                            ColorStop::percent(rgba(c[0], c[1], c[2], 0.0), 100.0),
                        ],
                    )
                    .into(),
                ];
            }
        }
        let streak = ids.flare[6];
        ui.show(streak, kq > 0);
        if let Ok(mut g) = ui.grad.get_mut(streak) {
            g.0 = vec![
                RadialGradient::new(
                    UiPosition::CENTER,
                    RadialGradientShape::Ellipse(percent(50.0), percent(50.0)),
                    vec![
                        ColorStop::percent(rgba(200, 230, 255, 0.2 * k), 0.0),
                        ColorStop::percent(rgba(170, 215, 255, 0.07 * k), 45.0),
                        ColorStop::percent(rgba(150, 200, 255, 0.0), 100.0),
                    ],
                )
                .into(),
            ];
        }
    }
    if let Some((q, _)) = flare {
        let to_c = center - q;
        for (i, (tpos, r, ..)) in GHOSTS.iter().enumerate() {
            ui.center(ids.flare[i], q + to_c * *tpos, Vec2::splat(100.0), 0.0, r * 2.0 / 100.0);
        }
        ui.center(ids.flare[6], q, Vec2::new(1200.0, STREAK_H), 0.0, w / 1500.0);
    }
}

/// height of the lens flare's anamorphic streak (web 2.4 px, soft-edged here)
const STREAK_H: f32 = 4.0;

fn hide_pool(ui: &mut Ui, pool: &[Entity], from: usize) {
    for &e in pool.iter().skip(from) {
        ui.show(e, false);
    }
}

/// Chevron on an ellipse around the screen centre pointing towards an off-screen world point.
/// In the cockpit the ellipse is flattened below the centre, clear of the instrument panel.
fn arrow(ui: &mut Ui, pr: &Proj, e: Entity, world: Vec3, cockpit: bool) {
    let a = pr.angle(world);
    let (w, h) = (pr.size.x, pr.size.y);
    let ry = if cockpit && a.sin() > 0.0 { h * 0.2 } else { h * 0.32 };
    let p = Vec2::new(w * 0.5 + a.cos() * h * 0.36, h * 0.5 + a.sin() * ry);
    ui.show(e, true);
    ui.center(e, p, Vec2::splat(22.0), a + FRAC_PI_4, 1.0);
}

// ---------- test hook ----------

/// `SF_HUD_TEST=1`: fills mission status, radio and banner with sample data (screenshots before mission.rs).
fn hud_test_hook(
    mut done: Local<bool>,
    anim: Res<HudAnim>,
    mut status: ResMut<MissionStatus>,
    mut comm: MessageWriter<CommMsg>,
    mut banner: MessageWriter<HudBanner>,
    mut players: Query<(&GlobalTransform, &mut Ship), With<Player>>,
) {
    if std::env::var("SF_HUD_TEST").is_err() || anim.time < 0.5 {
        return;
    }
    let Some((tf, mut ship)) = players.iter_mut().next() else { return };
    let p = tf.translation();
    let f = tf.rotation() * Vec3::Z;
    let r = tf.rotation() * Vec3::NEG_X;
    status.nav_pos = Some(p + f * 6400.0 + r * 1800.0 + Vec3::Y * 400.0);
    status.nav_name = "Nav 2".into();
    status.hostiles = 2;
    status.timer = Some(161.0);
    status.auto_available = true;
    status.objective = "Nav 1 von Feindkontakten säubern".into();
    status.markers.clear();
    status.markers.push((p + f * 900.0 - r * 260.0 - Vec3::Y * 120.0, "RETTUNGSKAPSEL".into(), [0.43, 1.0, 0.69]));
    if std::env::var("SF_HUD_TEST").is_ok_and(|v| v == "low") {
        ship.shield = 0.0;
        ship.hp = ship.max_hp * 0.22;
    }
    if !*done {
        *done = true;
        comm.write(CommMsg { who: "rook".into(), text: "Rook an {cs}: Zwei Dorns auf zwölf Uhr. Ich nehme den linken, du den rechten.".into() });
        comm.write(CommMsg { who: "brandt".into(), text: "Aurora an Nachtfalken: Gute Jagd.".into() });
        banner.write(HudBanner("NEUE FEINDWELLE".into()));
    }
}
