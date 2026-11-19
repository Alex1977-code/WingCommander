//! Flight: player input (keyboard, mouse, gamepad), the player's flight model (web `updatePilot()`),
//! AI ship steering from `Steer`, movement of every ship, and collisions of the player with capital
//! hulls and asteroids (web `bump()`).
//!
//! Frame order (all in `Update`, only in `AppState::Flight`):
//! `FlightSet::Input` -> `FlightSet::Ai` (ai.rs) -> `FlightSet::Steer` -> `FlightSet::Move` -> `FlightSet::Collide`
//! -> `WeaponsSet::*` (weapons.rs). Everything except `Input` stops while `Paused`.
//!
//! Test hook: `SF_PILOT=attack` flies the player automatically at the current target and fires (screenshots).

use crate::common::*;
use crate::render::{Asteroid, CameraShake};
use crate::ships::{HullBoxes, HullShape, AURORA_BAY};
use crate::weapons::Neutron;
use bevy::input::gamepad::{Gamepad, GamepadButton};
use bevy::input::mouse::{AccumulatedMouseMotion, AccumulatedMouseScroll, MouseScrollUnit};
use bevy::prelude::*;
use bevy::window::{CursorGrabMode, CursorOptions, PrimaryWindow};

/// Longest simulated frame step (web: `Math.min(0.05, dt)`), so a hitch never tunnels ships through hulls.
pub const MAX_DT: f32 = 0.05;
/// Impulse drive drops out with a hostile this close, or this close to the nav point.
const IMP_HOSTILE: f32 = 3500.0;
const IMP_NAV: f32 = 3700.0;
/// how far ahead the impulse drive looks for capital ships and rocks on the flight path
const IMP_LOOK: f32 = 3600.0;
/// T cycles through hostiles within this range; without a target the nearest within AUTO_TARGET is picked
const TARGET_RANGE: f32 = 8000.0;
const AUTO_TARGET: f32 = 4500.0;
/// mouse: stick deflection per pixel, and how fast the virtual stick re-centres (1/s)
const MOUSE_GAIN: f32 = 0.0035;
const MOUSE_RETURN: f32 = 3.0;

// ---------- public API ----------

/// System sets of the flight frame. ai.rs puts its systems into `FlightSet::Ai`.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FlightSet {
    /// keyboard / mouse / gamepad -> `Pilot`, `Trigger`, pause, view, target, autopilot (also runs while paused)
    Input,
    /// AI decisions: write `Steer` and `Trigger`
    Ai,
    /// player flight model and AI steering (rotation, bank, speed)
    Steer,
    /// translation of every ship
    Move,
    /// player vs capital hulls and asteroids
    Collide,
}

/// The player asked for the autopilot (J / gamepad Select). mission.rs decides whether it may jump.
#[derive(Message, Clone, Copy, Debug, Default)]
pub struct AutopilotRequest;

/// Something solid the player can crash into and that stops shots (mines), as a sphere of `radius`.
/// render.rs' asteroids get one too (see `tag_rocks`) so ai.rs and mission.rs see them; flight.rs and
/// weapons.rs test rocks against their real shape (`render::Asteroid`) instead.
#[derive(Component, Clone, Copy, Debug)]
pub struct Obstacle {
    pub radius: f32,
}

/// Blocks the impulse drive while the player is within `.0` metres (web IMPULSE.mine: live mines, 2200 m).
#[derive(Component, Clone, Copy, Debug)]
pub struct ImpulseBlock(pub f32);

/// Per-pilot input and flight state on the `Player` entity (added automatically).
#[derive(Component, Default, Clone, Debug)]
pub struct Pilot {
    /// raw stick (x > 0 = yaw right, y > 0 = stick pulled back / nose down unless inverted), each -1..1
    pub stick: Vec2,
    /// boost button held
    pub boost_held: bool,
    /// the impulse drive could engage here (clear stretch, see `impulse_clear`)
    pub impulse_clear: bool,
    key: Vec2,
    mouse: Vec2,
    boost_lock: bool,
    imp_t: f32,
    imp_chk_t: f32,
    bump_t: f32,
    /// visual pitch tilt of the model (rad)
    tilt: f32,
    /// position after the last collision pass (swept test against thin hull parts)
    prev: Option<Vec3>,
    /// flying inside the TUS Aurora's hangar tunnel (web `P.inTube`)
    in_tube: bool,
    /// SF_PILOT=bay log timer
    bay_log: f32,
    bay_lined: bool,
}

/// Signed distance from `p` to a capital ship's hull (oriented box from `Hittable::half_extents`, plus the
/// station ring `torus` = [ring radius, tube radius] around ship-space Z) and the outward world normal there.
/// Without a box the hull is the sphere `Hittable::radius`.
pub fn hull_distance(tf: &Transform, hit: &Hittable, torus: Option<[f32; 2]>, p: Vec3) -> (f32, Vec3) {
    hull_distance_shape(tf, hit, torus, None, p)
}

/// `hull_distance` including the capital's model hull (`ships::HullBoxes`: saucers, nacelles, prows).
pub fn hull_distance_shape(tf: &Transform, hit: &Hittable, torus: Option<[f32; 2]>, shape: Option<&HullShape>, p: Vec3) -> (f32, Vec3) {
    let l = tf.rotation.inverse() * (p - tf.translation);
    let (mut d, mut n) = match hit.half_extents {
        Some(h) => box_local(h, l),
        None => {
            let len = l.length();
            (len - hit.radius, if len > 1e-6 { l / len } else { Vec3::Y })
        }
    };
    if let Some((ds, ns)) = shape.and_then(|s| s.distance(l, d)) {
        d = ds;
        n = ns;
    }
    if let Some([ring, tube]) = torus {
        let radial = l.truncate().length().max(1e-6);
        let qx = radial - ring;
        let dt = (qx * qx + l.z * l.z).sqrt() - tube;
        if dt < d {
            d = dt;
            n = Vec3::new(l.x / radial * qx, l.y / radial * qx, l.z).normalize_or(Vec3::Z);
        }
    }
    (d, tf.rotation * n)
}

/// First point where the segment `a`-`b` comes within `margin` of the hull (see `hull_distance`), with the
/// fraction along the segment. Exact for the box, sampled every ~3.5 m for the ring.
#[allow(dead_code)] // public API (avoidance code in other modules)
pub fn segment_hull(tf: &Transform, hit: &Hittable, torus: Option<[f32; 2]>, a: Vec3, b: Vec3, margin: f32) -> Option<(Vec3, f32)> {
    segment_hull_shape(tf, hit, torus, None, a, b, margin)
}

/// `segment_hull` including the capital's model hull (`ships::HullBoxes`).
pub fn segment_hull_shape(tf: &Transform, hit: &Hittable, torus: Option<[f32; 2]>, shape: Option<&HullShape>, a: Vec3, b: Vec3, margin: f32) -> Option<(Vec3, f32)> {
    let inv = tf.rotation.inverse();
    let la = inv * (a - tf.translation);
    let lb = inv * (b - tf.translation);
    let mut best = match hit.half_extents {
        Some(h) => seg_box(la, lb, h + Vec3::splat(margin)),
        None => seg_sphere(la, lb, Vec3::ZERO, hit.radius + margin),
    };
    if let Some(t) = shape.and_then(|s| s.segment(la, lb, margin)) {
        best = Some(best.map_or(t, |b| b.min(t)));
    }
    if let Some([ring, tube]) = torus {
        // only march the part of the segment inside the ring's bounding sphere
        if let Some((t0, t1)) = seg_sphere_span(la, lb, Vec3::ZERO, ring + tube + margin) {
            let len = la.distance(lb) * (t1 - t0);
            let n = ((len / 3.5).ceil() as usize).clamp(1, 240);
            let end = best.unwrap_or(1.0).min(t1);
            for i in 0..=n {
                let t = t0 + (t1 - t0) * i as f32 / n as f32;
                if t > end {
                    break;
                }
                let l = la.lerp(lb, t);
                let qx = l.truncate().length() - ring;
                if (qx * qx + l.z * l.z).sqrt() - tube < margin {
                    best = Some(t);
                    break;
                }
            }
        }
    }
    best.map(|t| (a.lerp(b, t), t))
}

/// Rotation whose +Z (ship forward) points along `dir`, keeping `up` as far as possible.
pub fn rotation_facing(dir: Vec3, up: Vec3) -> Quat {
    let z = dir.normalize_or(Vec3::Z);
    let mut x = up.cross(z);
    if x.length_squared() < 1e-8 {
        x = z.any_orthonormal_vector();
    }
    let x = x.normalize();
    let y = z.cross(x);
    Quat::from_mat3(&Mat3::from_cols(x, y, z)).normalize()
}

/// Squared distance from `c` to the segment `a`-`b`, and the closest point.
pub fn seg_point(a: Vec3, b: Vec3, c: Vec3) -> (f32, Vec3) {
    let ab = b - a;
    let l2 = ab.length_squared();
    let k = if l2 > 0.0 { ((c - a).dot(ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let p = a + ab * k;
    (p.distance_squared(c), p)
}

// ---------- plugin ----------

pub struct FlightPlugin;

/// `SF_PILOT=attack`: the player flies itself at its target (automated screenshot runs);
/// `SF_PILOT=bay`: it flies into the TUS Aurora's hangar tunnel (collision test).
#[derive(Resource, Default)]
struct TestPilot {
    attack: bool,
    bay: bool,
}

/// One-shot radio hints per mission.
#[derive(Resource, Default)]
struct FlightHints {
    impulse: bool,
}

impl Plugin for FlightPlugin {
    fn build(&self, app: &mut App) {
        let flying = in_state(AppState::Flight);
        let running = |p: Res<Paused>| !p.0;
        app.add_message::<AutopilotRequest>()
            .insert_resource(TestPilot { attack: std::env::var("SF_PILOT").is_ok_and(|v| v == "attack"), bay: std::env::var("SF_PILOT").is_ok_and(|v| v == "bay") })
            .init_resource::<FlightHints>()
            .configure_sets(
                Update,
                (FlightSet::Input, FlightSet::Ai, FlightSet::Steer, FlightSet::Move, FlightSet::Collide).chain().run_if(flying.clone()),
            )
            .configure_sets(Update, (FlightSet::Ai, FlightSet::Steer, FlightSet::Move, FlightSet::Collide).run_if(running))
            .add_systems(OnEnter(AppState::Flight), reset_flight)
            .add_systems(OnExit(AppState::Flight), |mut paused: ResMut<Paused>| paused.0 = false)
            .add_systems(Update, tag_rocks)
            .add_systems(Update, (ensure_pilot, player_input, auto_target).chain().in_set(FlightSet::Input))
            .add_systems(Update, (player_flight, ai_steer, bank_bodies).chain().in_set(FlightSet::Steer))
            .add_systems(Update, move_ships.in_set(FlightSet::Move))
            .add_systems(Update, player_collisions.in_set(FlightSet::Collide))
            .add_systems(Update, cursor_capture);
    }
}

fn reset_flight(mut hints: ResMut<FlightHints>, mut paused: ResMut<Paused>) {
    *hints = FlightHints::default();
    paused.0 = false;
}

/// Every ship gets a `Trigger` (ai.rs and weapons.rs rely on it), the player a `Pilot`.
fn ensure_pilot(
    mut commands: Commands,
    players: Query<Entity, (With<Player>, Without<Pilot>)>,
    ships: Query<Entity, (With<Ship>, Without<Trigger>)>,
) {
    for e in &ships {
        commands.entity(e).insert(Trigger::default());
    }
    for e in &players {
        commands.entity(e).insert(Pilot::default());
    }
}

/// render.rs' asteroids also get an `Obstacle` (their bounding sphere), so ai.rs steers round them and
/// mission.rs keeps pickups clear of them. Collisions, the impulse drive and shots use `Asteroid` itself.
fn tag_rocks(mut commands: Commands, q: Query<(Entity, &Asteroid), (Added<Asteroid>, Without<Obstacle>)>) {
    for (e, rock) in &q {
        commands.entity(e).insert(Obstacle { radius: rock.radius });
    }
}

/// Dead zone + expo curve: precise near the centre, full authority at the edge (web `shape`).
fn shape(v: f32) -> f32 {
    let a = ((v.abs() - 0.05) / 0.95).max(0.0);
    v.signum() * a * (0.45 + 0.55 * a * a)
}

#[allow(clippy::too_many_arguments)]
fn player_input(
    time: Res<Time>,
    keys: Res<ButtonInput<KeyCode>>,
    mouse: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    scroll: Res<AccumulatedMouseScroll>,
    pads: Query<&Gamepad>,
    cursor: Query<&CursorOptions, With<PrimaryWindow>>,
    test: Res<TestPilot>,
    mut paused: ResMut<Paused>,
    mut settings: ResMut<Settings>,
    mut autopilot: MessageWriter<AutopilotRequest>,
    mut sfx: MessageWriter<SfxMsg>,
    mut pilots: Query<(&Transform, &Ship, &mut Player, &mut Pilot, &mut Trigger), Without<Dying>>,
    others: Query<(Entity, &Transform, &Ship), (Without<Player>, Without<Dying>)>,
    mut list: Local<Vec<(f32, Entity)>>,
) {
    let pad_pressed = |b: GamepadButton| pads.iter().any(|p| p.just_pressed(b));
    if keys.any_just_pressed([KeyCode::Escape, KeyCode::KeyP]) || pad_pressed(GamepadButton::Start) {
        paused.0 = !paused.0;
    }
    if paused.0 {
        for (.., mut trig) in &mut pilots {
            trig.guns = false;
        }
        return;
    }
    if keys.any_just_pressed([KeyCode::KeyV, KeyCode::KeyC]) || pad_pressed(GamepadButton::East) {
        settings.view = if settings.view == View::Cockpit { View::Chase } else { View::Cockpit };
        save_json("settings.json", &*settings);
    }
    if keys.just_pressed(KeyCode::KeyJ) || pad_pressed(GamepadButton::Select) {
        autopilot.write(AutopilotRequest);
    }
    let dt = time.delta_secs().min(MAX_DT);
    let grabbed = cursor.iter().any(|c| c.grab_mode != CursorGrabMode::None);

    for (tf, ship, mut player, mut pilot, mut trig) in &mut pilots {
        // keyboard: smoothed digital stick
        let axis = |pos: &[KeyCode], neg: &[KeyCode]| (keys.any_pressed(pos.iter().copied()) as i32 - keys.any_pressed(neg.iter().copied()) as i32) as f32;
        let kt = Vec2::new(
            axis(&[KeyCode::KeyD, KeyCode::ArrowRight], &[KeyCode::KeyA, KeyCode::ArrowLeft]),
            axis(&[KeyCode::KeyS, KeyCode::ArrowDown], &[KeyCode::KeyW, KeyCode::ArrowUp]),
        );
        let a = (dt * 8.0).min(1.0);
        let key = pilot.key;
        pilot.key = key + (kt - key) * a;
        // mouse: a virtual stick that springs back to the centre (only while the cursor is captured)
        if grabbed {
            pilot.mouse = (pilot.mouse + motion.delta * MOUSE_GAIN).clamp_length_max(1.0);
        }
        pilot.mouse *= (-dt * MOUSE_RETURN).exp();
        // gamepads: left stick steers (screen convention: pushed up = y < 0), right stick / d-pad throttle
        let mut pad_stick = Vec2::ZERO;
        let mut pad_thr = 0.0;
        let (mut pad_fire, mut pad_boost) = (false, false);
        for p in &pads {
            let s = p.left_stick();
            pad_stick += Vec2::new(s.x, -s.y);
            pad_thr += p.right_stick().y + p.dpad().y;
            pad_fire |= p.get(GamepadButton::RightTrigger2).unwrap_or(0.0) > 0.35 || p.pressed(GamepadButton::RightTrigger2);
            pad_boost |= p.get(GamepadButton::LeftTrigger2).unwrap_or(0.0) > 0.35 || p.pressed(GamepadButton::LeftTrigger2);
        }
        let raw = pilot.key + pilot.mouse + pad_stick;
        pilot.stick = raw.clamp(Vec2::NEG_ONE, Vec2::ONE);

        // throttle: Q/E (+/-), wheel, right stick, d-pad
        // +/- also on German layouts (physical BracketRight / Slash carry '+' / '-' there)
        let rate = axis(
            &[KeyCode::KeyE, KeyCode::Equal, KeyCode::BracketRight, KeyCode::NumpadAdd],
            &[KeyCode::KeyQ, KeyCode::Minus, KeyCode::Slash, KeyCode::NumpadSubtract],
        ) + pad_thr;
        let wheel = match scroll.unit {
            MouseScrollUnit::Line => scroll.delta.y * 0.08,
            MouseScrollUnit::Pixel => scroll.delta.y * 0.002,
        };
        player.throttle = (player.throttle + rate.clamp(-1.0, 1.0) * dt * 0.8 + wheel).clamp(0.0, 1.0);

        let mut fire = keys.pressed(KeyCode::Space) || mouse.pressed(MouseButton::Left) || pad_fire;
        pilot.boost_held = keys.any_pressed([KeyCode::ShiftLeft, KeyCode::ShiftRight]) || pad_boost;
        let mut neutron = keys.any_just_pressed([KeyCode::KeyM, KeyCode::Enter, KeyCode::NumpadEnter])
            || mouse.just_pressed(MouseButton::Right)
            || pad_pressed(GamepadButton::South)
            || pad_pressed(GamepadButton::West);

        if test.bay {
            // fly along the hangar's centre line into the tube, slowly
            if let Some((_, ctf, _)) = others.iter().find(|(_, _, s)| s.kind == "aurora") {
                let b = &AURORA_BAY;
                let l = ctf.rotation.inverse() * (tf.translation - ctf.translation);
                // first a point on the centre line far ahead of the mouth, then along the line into the tube
                let start = Vec3::new(0.0, b.y - 0.5, b.mouth + 400.0);
                if l.distance(start) < 40.0 {
                    pilot.bay_lined = true;
                }
                let goal = if pilot.bay_lined { Vec3::new(0.0, b.y - 0.5, (l.z - 60.0).max(b.back)) } else { start };
                let aim = ctf.translation + ctf.rotation * goal;
                let local = tf.rotation.inverse() * (aim - tf.translation).normalize_or(Vec3::Z);
                let behind = if local.z < 0.0 { 1.0 } else { 0.0 };
                pilot.stick = Vec2::new((-local.x * 4.0 + behind).clamp(-1.0, 1.0), (-local.y * 4.0).clamp(-1.0, 1.0));
                player.throttle = if pilot.bay_lined { 0.05 } else { 0.4 };
                fire = false;
                neutron = false;
                pilot.bay_log -= dt;
                if pilot.bay_log <= 0.0 {
                    pilot.bay_log = 0.5;
                    info!("bay pilot: carrier-local {:.1} in tube {} speed {:.0}", l, pilot.in_tube, ship.speed);
                }
            }
        }
        if test.attack {
            // automated pilot: steer at the target's lead point, fire when lined up, discharge the neutron cannon on lock
            if let Some((ttf, tship)) = player.target.and_then(|t| others.get(t).ok()).map(|(_, t, s)| (t, s)) {
                let dist = ttf.translation.distance(tf.translation);
                let lead = ttf.translation + fwd(ttf) * tship.speed * dist / BOLT_SPEED;
                let local = tf.rotation.inverse() * (lead - tf.translation).normalize_or(Vec3::Z);
                let behind = if local.z < 0.0 { 1.0 } else { 0.0 };
                pilot.stick = Vec2::new((-local.x * 4.0 + behind).clamp(-1.0, 1.0), (-local.y * 4.0).clamp(-1.0, 1.0));
                fire = local.z > 0.985 && dist < 1100.0;
                neutron = player.lock >= 1.0;
                player.throttle = if dist > 900.0 { 1.0 } else { 0.6 };
            } else {
                // nothing to fight: cruise on boost (engages the impulse drive on a clear stretch)
                pilot.boost_held = true;
            }
        }

        trig.guns = fire;
        if neutron {
            trig.missile = true;
        }

        // T / Y: cycle hostiles, best first (close and in front)
        if keys.just_pressed(KeyCode::KeyT) || pad_pressed(GamepadButton::North) {
            let f = fwd(tf);
            list.clear();
            for (e, otf, o) in &others {
                let v = otf.translation - tf.translation;
                let d = v.length();
                if o.team.hostile_to(ship.team) && !o.def.ghost && d < TARGET_RANGE {
                    list.push((d * (1.6 - v.dot(f) / d.max(1e-3)), e));
                }
            }
            list.sort_by(|a, b| a.0.total_cmp(&b.0));
            player.target = match player.target.and_then(|t| list.iter().position(|x| x.1 == t)) {
                Some(i) => Some(list[(i + 1) % list.len()].1),
                None => list.first().map(|x| x.1),
            };
            player.lock = 0.0;
            sfx.write(SfxMsg::Lock);
        }
    }
}

/// Drop dead targets; without one, pick the nearest hostile (capital ships count 1.5x as far).
fn auto_target(mut pilots: Query<(&Transform, &Ship, &mut Player), Without<Dying>>, others: Query<(Entity, &Transform, &Ship), (Without<Player>, Without<Dying>)>) {
    for (tf, ship, mut player) in &mut pilots {
        if player.target.is_some_and(|t| others.get(t).is_err()) {
            player.target = None;
            player.lock = 0.0;
        }
        if player.target.is_some() {
            continue;
        }
        let mut best = (AUTO_TARGET, None);
        for (e, otf, o) in &others {
            if !o.team.hostile_to(ship.team) || o.def.ghost {
                continue;
            }
            let d = otf.translation.distance(tf.translation) * if o.capital() { 1.5 } else { 1.0 };
            if d < best.0 {
                best = (d, Some(e));
            }
        }
        player.target = best.1;
    }
}

/// The impulse drive needs open space: no hostiles near, the nav point still far, no capital ship or rock
/// close or on the path ahead, and the mission in a travel phase (a nav point to fly to, no timer).
type OthersQuery<'w, 's> = Query<'w, 's, (&'static Transform, &'static Ship, &'static Hittable, Option<&'static HullBoxes>), (Without<Player>, Without<Dying>)>;
type RocksQuery<'w, 's> = Query<'w, 's, (&'static Transform, &'static Asteroid), Without<Player>>;
type ObstaclesQuery<'w, 's> = Query<'w, 's, (&'static Transform, &'static Obstacle), (Without<Player>, Without<Asteroid>)>;

fn impulse_clear(
    tf: &Transform,
    team: Team,
    status: &MissionStatus,
    others: &OthersQuery,
    rocks: &RocksQuery,
    obstacles: &ObstaclesQuery,
    blocks: &Query<(&Transform, &ImpulseBlock), Without<Player>>,
) -> bool {
    if status.ended.is_some() || status.timer.is_some() {
        return false;
    }
    let Some(nav) = status.nav_pos else { return false };
    let pos = tf.translation;
    if pos.distance_squared(nav) < IMP_NAV * IMP_NAV {
        return false;
    }
    if blocks.iter().any(|(btf, b)| btf.translation.distance_squared(pos) < b.0 * b.0) {
        return false;
    }
    let f = fwd(tf);
    let in_path = |c: Vec3, r: f32, side: f32, near: f32| {
        let rel = c - pos;
        let d2 = rel.length_squared();
        if d2 < (r + near) * (r + near) {
            return true;
        }
        let al = rel.dot(f);
        al > 0.0 && al < IMP_LOOK + r && d2 - al * al < (r + side) * (r + side)
    };
    for (otf, o, hit, hull) in others {
        if o.team.hostile_to(team) && otf.translation.distance_squared(pos) < IMP_HOSTILE * IMP_HOSTILE {
            return false;
        }
        let r = hit.radius.max(hull.map_or(0.0, |h| h.0.extent));
        if o.capital() && !o.def.ghost && in_path(otf.translation, r, 600.0, 500.0) {
            return false;
        }
    }
    !rocks.iter().any(|(rtf, rock)| in_path(rtf.translation, rock.radius, 300.0, 350.0))
        && !obstacles.iter().any(|(otf, o)| in_path(otf.translation, o.radius, 300.0, 350.0))
}

/// The player's flight model (web updatePilot): turn rates, bank, throttle, boost energy, impulse drive.
#[allow(clippy::too_many_arguments)]
fn player_flight(
    time: Res<Time>,
    settings: Res<Settings>,
    status: Res<MissionStatus>,
    progress: Res<Progress>,
    mut hints: ResMut<FlightHints>,
    mut comm: MessageWriter<CommMsg>,
    mut sfx: MessageWriter<SfxMsg>,
    mut shake: ResMut<CameraShake>,
    mut pilots: Query<(&mut Transform, &mut Ship, &mut Player, &mut Pilot, &Trigger, Option<&Neutron>), Without<Dying>>,
    others: OthersQuery,
    rocks: RocksQuery,
    obstacles: ObstaclesQuery,
    blocks: Query<(&Transform, &ImpulseBlock), Without<Player>>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    for (mut tf, mut ship, mut player, mut pilot, trig, neutron) in &mut pilots {
        let (speed, turn) = (ship.def.speed, ship.def.turn);
        let boost_speed = ship.def.boost.unwrap_or(speed * 2.0);
        let sx = shape(pilot.stick.x);
        let sy = shape(pilot.stick.y) * if settings.invert { 1.0 } else { -1.0 };
        let mode = if player.impulse { 0.4 } else if player.boosting { 0.7 } else { 1.0 };
        let rate = turn * mode * settings.sensitivity.max(0.05);
        tf.rotation = (tf.rotation * Quat::from_rotation_x(-sy * rate * dt) * Quat::from_rotation_y(-sx * rate * dt)).normalize();
        ship.bank += (sx * 0.75 - ship.bank) * (dt * 5.0).min(1.0);
        pilot.tilt = -sy * 0.12;

        // boost energy and its lockout when drained
        if player.energy <= 0.02 {
            pilot.boost_lock = true;
        }
        if pilot.boost_lock && (player.energy > 0.3 || !pilot.boost_held) {
            pilot.boost_lock = false;
        }
        let boosting = pilot.boost_held && !pilot.boost_lock && (player.energy > 0.02 || player.impulse);

        // impulse drive: boost held on a clear stretch; firing or charging the neutron cannon cancels it
        pilot.imp_chk_t -= dt;
        if pilot.imp_chk_t <= 0.0 {
            pilot.imp_chk_t = 0.2;
            pilot.impulse_clear = impulse_clear(&tf, ship.team, &status, &others, &rocks, &obstacles, &blocks);
        }
        let charging = neutron.is_some_and(|n| n.charge.is_some());
        pilot.imp_t = if boosting && pilot.impulse_clear && !trig.guns && !trig.missile && !charging { pilot.imp_t + dt } else { 0.0 };
        let impulse = pilot.imp_t > IMPULSE_SPOOL;
        player.impulse_prog = (pilot.imp_t / IMPULSE_SPOOL).min(1.0);
        if impulse && !player.impulse {
            sfx.write(SfxMsg::Warp);
        }
        if pilot.imp_t > 0.0 && !impulse {
            // the drive spooling up rattles the ship (web: 0.04 + t * 0.02)
            shake.bump(0.04 + pilot.imp_t * 0.02);
        }
        player.impulse = impulse;
        player.energy = if impulse {
            (player.energy + dt * 0.05).min(1.0)
        } else if boosting {
            (player.energy - dt * 0.22).max(0.0)
        } else {
            (player.energy + dt * 0.1).min(1.0)
        };
        player.boosting = boosting;

        let want = if impulse {
            IMPULSE_SPEED
        } else if boosting {
            boost_speed
        } else {
            speed * (0.15 + player.throttle * 0.85)
        };
        player.want_speed = want;
        // spools up gently, brakes hard when the impulse drive drops out (inertial dampers)
        let k = if impulse {
            1.25
        } else if ship.speed > boost_speed * 1.05 {
            3.5
        } else if boosting {
            1.8
        } else {
            1.2
        };
        ship.speed += (want - ship.speed) * (dt * k).min(1.0);

        if !hints.impulse && pilot.impulse_clear && !boosting && status.nav_pos.is_some() {
            hints.impulse = true;
            comm.write(CommMsg { who: "flug".into(), text: fill_callsign("Kurs ist frei, {cs}. Boost halten für den Impulsantrieb.", &progress.callsign) });
        }
    }
}

/// Computer-controlled ships turn towards `Steer::dir` (limited by their turn rate), bank into the turn
/// and change speed towards `Steer::speed` (web `steer()` and the speed line of `updateAI`).
fn ai_steer(time: Res<Time>, mut q: Query<(&mut Transform, &mut Ship, &Steer, Option<&Ai>), (Without<Player>, Without<Dying>)>) {
    let dt = time.delta_secs().min(MAX_DT);
    for (mut tf, mut ship, steer, ai) in &mut q {
        let dir = steer.dir.normalize_or_zero();
        let capital = ship.capital();
        if dir != Vec3::ZERO {
            let rate = if capital {
                if ship.def.turn > 0.0 { ship.def.turn } else { 0.35 }
            } else {
                let skill = ai.map_or(ship.def.skill, |a| a.skill);
                ship.def.turn * (0.75 + skill.clamp(0.0, 1.0) * 0.25)
            };
            let local = tf.rotation.inverse() * dir;
            let bank_max = if capital { 0.12 } else { 0.9 };
            let want = (-local.x * 1.6).clamp(-bank_max, bank_max);
            ship.bank += (want - ship.bank) * (dt * 3.0).min(1.0);
            let target = rotation_facing(dir, tf.rotation * Vec3::Y);
            tf.rotation = tf.rotation.rotate_towards(target, rate * dt).normalize();
        } else {
            ship.bank *= 1.0 - (dt * 2.0).min(1.0);
        }
        let boost = ship.def.boost.unwrap_or(ship.def.speed * 2.0);
        let k = if ship.speed > boost * 1.05 || steer.speed > boost {
            3.5
        } else if capital {
            0.4
        } else {
            1.4
        };
        ship.speed += (steer.speed - ship.speed) * (dt * k).min(1.0);
    }
}

/// Bank (and for the player a little pitch tilt) is shown on the model only, so the flight path stays clean.
fn bank_bodies(ships: Query<(&Ship, &Children, Option<&Pilot>)>, mut bodies: Query<&mut Transform, (With<ShipBody>, Without<Ship>)>) {
    for (ship, children, pilot) in &ships {
        let rot = Quat::from_rotation_x(pilot.map_or(0.0, |p| p.tilt)) * Quat::from_rotation_z(ship.bank);
        for child in children.iter() {
            if let Ok(mut t) = bodies.get_mut(child) {
                if t.rotation != rot {
                    t.rotation = rot;
                }
            }
        }
    }
}

/// Every ship flies along its +Z at its speed.
fn move_ships(time: Res<Time>, mut q: Query<(&mut Transform, &Ship)>) {
    let dt = time.delta_secs().min(MAX_DT);
    for (mut tf, ship) in &mut q {
        if ship.speed != 0.0 {
            let f = fwd(&tf);
            tf.translation += f * ship.speed * dt;
        }
    }
}

/// Player vs asteroids, mines and capital hulls: pushed out, deflected along the surface, damaged, slowed
/// (web `bump`). Inside the TUS Aurora's hangar tunnel the tube walls hold the ship instead (web `bayConstrain`).
#[allow(clippy::too_many_arguments)]
fn player_collisions(
    time: Res<Time>,
    mut pilots: Query<(Entity, &mut Transform, &mut Ship, &mut Pilot), Without<Dying>>,
    caps: Query<(&Transform, &Ship, &Hittable, Option<&HullBoxes>), (Without<Pilot>, Without<Dying>)>,
    rocks: Query<(&Transform, &Asteroid), Without<Pilot>>,
    obstacles: Query<(&Transform, &Obstacle), (Without<Pilot>, Without<Asteroid>)>,
    mut damage: MessageWriter<DamageMsg>,
    mut shake: ResMut<CameraShake>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    for (e, mut tf, mut ship, mut pilot) in &mut pilots {
        pilot.bump_t -= dt;
        // last frame's position for the swept hull test (not across a jump or teleport)
        let prev = pilot.prev.take().filter(|p| p.distance_squared(tf.translation) < 150.0 * 150.0);
        for (rtf, rock) in &rocks {
            // the rock's real (ellipsoid) shape, not its bounding sphere (web rockDepth)
            if let Some((depth, n)) = rock.depth(rtf, tf.translation, 5.0) {
                bump(e, &mut tf, &mut ship, &mut pilot, n, depth, 0.5, &mut damage, &mut shake);
            }
        }
        for (otf, ob) in &obstacles {
            let rel = tf.translation - otf.translation;
            let r = ob.radius + 5.0;
            let d2 = rel.length_squared();
            if d2 < r * r {
                let d = d2.sqrt();
                let n = if d > 1e-3 { rel / d } else { Vec3::Y };
                bump(e, &mut tf, &mut ship, &mut pilot, n, r - d, 0.5, &mut damage, &mut shake);
            }
        }
        for (ctf, cap, hit, hull) in &caps {
            if !cap.capital() || cap.def.ghost {
                continue;
            }
            let shape = hull.map(|h| &*h.0);
            let reach = hit.radius.max(shape.map_or(0.0, |s| s.extent)) + 40.0;
            let carrier = cap.kind == "aurora";
            if tf.translation.distance_squared(ctf.translation) > reach * reach {
                if carrier {
                    pilot.in_tube = false;
                }
                continue;
            }
            if carrier {
                let l = ctf.rotation.inverse() * (tf.translation - ctf.translation);
                // in the tube only when the ship came in through the mouth (not touching the back wall from outside)
                if in_bay_corridor(l, 90.0) && (pilot.in_tube || l.z > AURORA_BAY.back + 6.0) {
                    pilot.in_tube = true;
                    bay_constrain(e, &mut tf, &mut ship, &mut pilot, ctf, l, dt, &mut damage, &mut shake);
                    continue;
                }
                pilot.in_tube = false;
            }
            // swept: a fast ship must not slip through a thin part of the hull between two frames
            if let Some(a) = prev {
                if let Some((p, k)) = segment_hull_shape(ctf, hit, cap.def.torus, shape, a, tf.translation, 0.0) {
                    if k > 0.0 {
                        tf.translation = p - (tf.translation - a).normalize_or_zero() * 0.5;
                    }
                }
            }
            let (d, n) = hull_distance_shape(ctf, hit, cap.def.torus, shape, tf.translation);
            if d < 6.0 {
                bump(e, &mut tf, &mut ship, &mut pilot, n, 6.0 - d, 0.9, &mut damage, &mut shake);
            }
        }
        pilot.prev = Some(tf.translation);
    }
}

/// Is a carrier-local point inside the hangar tube or its approach corridor (lined up with the opening)?
fn in_bay_corridor(l: Vec3, ahead: f32) -> bool {
    let b = &AURORA_BAY;
    l.x.abs() < b.hw - 1.5 && (l.y - b.y).abs() < b.hh - 0.5 && l.z > b.back - 25.0 && l.z < b.mouth + ahead
}

/// Flying by hand inside the tube: the walls stop the ship (scraping hurts at speed), the nose eases onto
/// the tube's axis (web `bayConstrain`).
#[allow(clippy::too_many_arguments)]
fn bay_constrain(
    e: Entity,
    tf: &mut Transform,
    ship: &mut Ship,
    pilot: &mut Pilot,
    ctf: &Transform,
    l: Vec3,
    dt: f32,
    damage: &mut MessageWriter<DamageMsg>,
    shake: &mut CameraShake,
) {
    let b = &AURORA_BAY;
    if l.z > b.mouth {
        return;
    }
    let (mx, my) = (b.hw - 3.5, b.hh - 1.6);
    let mut c = l;
    let mut hit = false;
    if c.x.abs() > mx {
        c.x = mx.copysign(c.x);
        hit = true;
    }
    if (c.y - b.y).abs() > my {
        c.y = b.y + my.copysign(c.y - b.y);
        hit = true;
    }
    if c.z < b.back + 6.0 {
        c.z = b.back + 6.0;
        hit = true;
        ship.speed = ship.speed.min(20.0);
    }
    if hit {
        tf.translation = ctf.translation + ctf.rotation * c;
        if pilot.bump_t <= 0.0 && ship.speed > 70.0 {
            pilot.bump_t = 0.4;
            damage.write(DamageMsg { target: e, amount: 4.0 + ship.speed * 0.03, source: None, point: tf.translation });
            shake.bump(0.5);
        }
    }
    // gentle: the pilot can still steer against it
    let fz = (ctf.rotation.inverse() * fwd(tf)).z;
    let want = if fz < 0.0 { ctf.rotation * Quat::from_rotation_y(std::f32::consts::PI) } else { ctf.rotation };
    tf.rotation = tf.rotation.rotate_towards(want, 0.3 * dt).normalize();
}

#[allow(clippy::too_many_arguments)]
fn bump(
    e: Entity,
    tf: &mut Transform,
    ship: &mut Ship,
    pilot: &mut Pilot,
    n: Vec3,
    depth: f32,
    jolt: f32,
    damage: &mut MessageWriter<DamageMsg>,
    shake: &mut CameraShake,
) {
    tf.translation += n * (depth + 1.0);
    let f = fwd(tf);
    let into = f.dot(n);
    if into < 0.0 {
        let slide = (f - n * into * 1.4).normalize_or(n);
        tf.rotation = rotation_facing(slide, tf.rotation * Vec3::Y);
    }
    if pilot.bump_t <= 0.0 {
        pilot.bump_t = 0.5;
        damage.write(DamageMsg { target: e, amount: 12.0 + ship.speed * 0.08, source: None, point: tf.translation - n * ship.radius() * 0.8 });
        ship.speed *= 0.5;
        // web: a hull bump jolts the camera hard, a rock scrape less
        shake.bump(jolt);
        debug!("bump: depth {depth:.1} normal {n:.2} jolt {jolt} at {:.0}", tf.translation);
    }
}

/// Flying captures the mouse (relative steering); menus and the pause screen release it.
fn cursor_capture(state: Res<State<AppState>>, paused: Res<Paused>, mut cursors: Query<&mut CursorOptions, With<PrimaryWindow>>) {
    let fly = *state.get() == AppState::Flight && !paused.0;
    let mode = if fly { CursorGrabMode::Locked } else { CursorGrabMode::None };
    for mut c in &mut cursors {
        if c.grab_mode != mode || c.visible == fly {
            c.grab_mode = mode;
            c.visible = !fly;
        }
    }
}

// ---------- geometry helpers ----------

/// Distance to an axis-aligned box (half extents `h`) at the origin, negative inside, and the push direction.
fn box_local(h: Vec3, l: Vec3) -> (f32, Vec3) {
    let c = l.clamp(-h, h);
    let off = l - c;
    let d = off.length();
    if d > 1e-3 {
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

/// Entry fraction of the segment a-b into the box (slab test); 0 when it starts inside.
fn seg_box(a: Vec3, b: Vec3, h: Vec3) -> Option<f32> {
    let d = b - a;
    let (mut t0, mut t1) = (0.0f32, 1.0f32);
    for i in 0..3 {
        if d[i].abs() < 1e-8 {
            if a[i].abs() > h[i] {
                return None;
            }
        } else {
            let inv = 1.0 / d[i];
            let (mut ta, mut tb) = ((-h[i] - a[i]) * inv, (h[i] - a[i]) * inv);
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

/// Fractions where the segment a-b is inside the sphere (clamped to the segment).
fn seg_sphere_span(a: Vec3, b: Vec3, c: Vec3, r: f32) -> Option<(f32, f32)> {
    let d = b - a;
    let len2 = d.length_squared();
    if len2 < 1e-12 {
        return (a.distance_squared(c) < r * r).then_some((0.0, 0.0));
    }
    let m = a - c;
    let bq = m.dot(d) / len2;
    let cq = (m.length_squared() - r * r) / len2;
    let disc = bq * bq - cq;
    if disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    let (t0, t1) = ((-bq - s).max(0.0), (-bq + s).min(1.0));
    (t0 <= t1).then_some((t0, t1))
}

fn seg_sphere(a: Vec3, b: Vec3, c: Vec3, r: f32) -> Option<f32> {
    seg_sphere_span(a, b, c, r).map(|s| s.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facing_points_ship_forward() {
        let q = rotation_facing(Vec3::X, Vec3::Y);
        assert!((q * Vec3::Z).distance(Vec3::X) < 1e-5);
        assert!((q * Vec3::Y).distance(Vec3::Y) < 1e-5);
    }

    #[test]
    fn box_segment_and_distance() {
        let tf = Transform::from_xyz(100.0, 0.0, 0.0);
        let hit = Hittable { radius: 50.0, half_extents: Some(Vec3::new(10.0, 5.0, 30.0)) };
        let (d, n) = hull_distance(&tf, &hit, None, Vec3::new(100.0, 20.0, 0.0));
        assert!((d - 15.0).abs() < 1e-4 && n.distance(Vec3::Y) < 1e-5);
        let p = segment_hull(&tf, &hit, None, Vec3::new(50.0, 0.0, 0.0), Vec3::new(150.0, 0.0, 0.0), 0.0).unwrap();
        assert!((p.0.x - 90.0).abs() < 1e-3);
        assert!(segment_hull(&tf, &hit, None, Vec3::new(50.0, 20.0, 0.0), Vec3::new(150.0, 20.0, 0.0), 2.5).is_none());
    }

    #[test]
    fn ring_is_hit() {
        let tf = Transform::IDENTITY;
        let hit = Hittable { radius: 200.0, half_extents: Some(Vec3::splat(46.0)) };
        let p = segment_hull(&tf, &hit, Some([150.0, 17.0]), Vec3::new(150.0, 0.0, -100.0), Vec3::new(150.0, 0.0, 100.0), 0.0);
        assert!(p.is_some_and(|(p, _)| (p.z + 17.0).abs() < 4.0));
    }
}
