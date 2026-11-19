//! Computer pilots (port of src/game.js pickTarget / updateAI / updateCapital).
//! Writes `Steer` (where to fly) and `Trigger` (what to fire) for every ship with `Ai` and no `Player`;
//! flight.rs turns and moves the ships, weapons.rs fires. Also the wingman's formation flying and radio chatter.
//!
//! Test hook: SF_AI_LOG=1 prints every fighter's state every 3 s.

use crate::common::*;
use crate::flight::{hull_distance, FlightSet, Obstacle, MAX_DT};
use bevy::prelude::*;

pub struct AiPlugin;

/// The wingman only engages hostiles within this distance of the player.
const WING_LEASH: f32 = 3000.0;

impl Plugin for AiPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<AiContext>()
            .init_resource::<WingChatter>()
            .insert_resource(AiRng::seeded())
            .add_systems(OnEnter(AppState::Flight), reset_chatter)
            // FlightSet::Ai only runs in flight and not while paused
            .add_systems(Update, (init_ai, react_to_hits, kill_chatter, think).chain().in_set(FlightSet::Ai));
        if std::env::var("SF_AI_LOG").is_ok_and(|v| v != "0") {
            app.add_systems(Update, log_ai.after(think).in_set(FlightSet::Ai));
        }
    }
}

/// What the AI needs to know about the mission (written by mission.rs every frame).
#[derive(Resource, Default, Clone, Debug)]
pub struct AiContext {
    /// the carrier TUS Aurora
    pub carrier: Option<Entity>,
    /// the mission is about defending the carrier (bombers may go for it from far away)
    pub protect_carrier: bool,
    /// no fight going on at the current nav (the wingman may use the impulse drive to keep up)
    pub travel: bool,
}

/// Fixed cruise speed for ships that follow `Ai::dest` (convoy freighters, the fleeing courier).
#[derive(Component, Clone, Copy, Debug)]
pub struct Cruise(pub f32);

/// Small fast xorshift random generator (deterministic per run, no extra crate).
#[derive(Resource, Clone, Debug)]
pub struct AiRng(u64);

impl AiRng {
    pub fn seeded() -> Self {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9e37_79b9);
        Self(t | 1)
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    /// 0..1
    pub fn f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }
    pub fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.f32()
    }
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next_u64() % items.len() as u64) as usize]
    }
    /// uniformly distributed unit vector
    pub fn dir(&mut self) -> Vec3 {
        let z = self.range(-1.0, 1.0);
        let a = self.range(0.0, std::f32::consts::TAU);
        let r = (1.0 - z * z).max(0.0).sqrt();
        Vec3::new(r * a.cos(), r * a.sin(), z)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum Mode {
    #[default]
    Attack,
    Break,
}

/// Per-ship AI memory (added automatically to every `Ai` ship).
#[derive(Component, Clone, Debug, Default)]
pub struct AiState {
    mode: Mode,
    t: f32,
    retarget: f32,
    break_dir: Vec3,
    evade_t: f32,
    evade: Vec3,
    msl_cool: f32,
    torp_cool: f32,
    /// who hit this ship last (to credit the wingman's kills on the radio)
    pub last_hit_by: Option<Entity>,
}

/// Radio chatter cooldowns of the wingman.
#[derive(Resource, Default)]
struct WingChatter {
    last_call: f32,
    clock: f32,
}

fn reset_chatter(mut w: ResMut<WingChatter>) {
    *w = WingChatter { last_call: -1e4, clock: 0.0 };
}

/// One ship as seen by the AI this frame (snapshot, so the AI can steer while reading everybody else).
#[derive(Clone, Copy)]
struct Snap {
    e: Entity,
    pos: Vec3,
    rot: Quat,
    speed: f32,
    team: Team,
    capital: bool,
    ghost: bool,
    radius: f32,
    hit: Hittable,
    torus: Option<[f32; 2]>,
    player: bool,
    /// this ship's AI target (or the player's selected target)
    target: Option<Entity>,
    /// the target is a player
    hunts_player: bool,
    boost: f32,
}

fn init_ai(mut commands: Commands, mut q: Query<(Entity, &Ship, &mut Ai, Has<Steer>, Has<Trigger>), Without<AiState>>, mut rng: ResMut<AiRng>) {
    for (e, ship, mut ai, has_steer, has_trigger) in &mut q {
        if ai.skill <= 0.0 {
            ai.skill = if ship.def.skill > 0.0 { ship.def.skill } else { 0.5 };
        }
        let st = AiState { retarget: rng.range(0.0, 0.6), msl_cool: rng.range(4.0, 9.0), torp_cool: rng.range(3.0, 6.0), ..default() };
        let mut ec = commands.entity(e);
        ec.try_insert(st);
        if !has_steer {
            ec.try_insert(Steer { dir: Vec3::Z, speed: ship.speed });
        }
        if !has_trigger {
            ec.try_insert(Trigger::default());
        }
    }
}

/// A hit makes fighters jink for a moment (web: damage() sets ai.evadeT).
fn react_to_hits(mut hits: MessageReader<DamageMsg>, mut q: Query<(&Ship, &mut AiState)>, mut rng: ResMut<AiRng>) {
    for h in hits.read() {
        let Ok((ship, mut st)) = q.get_mut(h.target) else { continue };
        if h.source.is_some() {
            st.last_hit_by = h.source;
        }
        if !ship.capital() {
            st.evade_t = 0.9;
            st.evade = rng.dir();
        }
    }
}

/// Wingman radio lines on kills.
fn kill_chatter(
    mut kills: MessageReader<KilledMsg>,
    wing: Query<(Entity, &Ai), (Without<Dying>, Without<Player>)>,
    victims: Query<&AiState>,
    progress: Res<Progress>,
    mut rng: ResMut<AiRng>,
    mut comm: MessageWriter<CommMsg>,
) {
    if kills.is_empty() {
        return;
    }
    let wingman = wing.iter().find(|(_, a)| a.wingman).map(|(e, a)| (e, a.who.clone().unwrap_or_default()));
    for k in kills.read() {
        let Some((we, who)) = &wingman else { continue };
        if k.team != Team::Aszendenz || k.entity == *we {
            continue;
        }
        if k.by_player {
            if rng.f32() < 0.3 {
                let line = *rng.pick(&["Guter Schuss, {cs}!", "Abschuss bestätigt!", "Den hast du sauber erwischt!"]);
                comm.write(CommMsg { who: who.clone(), text: fill_callsign(line, &progress.callsign) });
            }
        } else if victims.get(k.entity).is_ok_and(|v| v.last_hit_by == Some(*we)) && rng.f32() < 0.5 {
            let line = *rng.pick(&["Einer weniger!", "Ziel zerstört!", "Erwischt!"]);
            comm.write(CommMsg { who: who.clone(), text: line.into() });
        }
    }
}

type AiQuery<'w, 's> = Query<
    'w,
    's,
    (Entity, &'static Transform, &'static Ship, &'static mut Ai, &'static mut AiState, &'static mut Steer, &'static mut Trigger, Option<&'static Cruise>),
    (Without<Player>, Without<Dying>),
>;

#[allow(clippy::too_many_arguments)]
fn think(
    time: Res<Time>,
    ctx: Res<AiContext>,
    progress: Res<Progress>,
    mut rng: ResMut<AiRng>,
    mut chatter: ResMut<WingChatter>,
    mut comm: MessageWriter<CommMsg>,
    mut snaps: Local<Vec<Snap>>,
    mut rocks: Local<Vec<(Vec3, f32)>>,
    obstacles: Query<(&Transform, &Obstacle), Without<Ship>>,
    mut set: ParamSet<(
        Query<(Entity, &Transform, &Ship, Option<&Ai>, Option<&Player>, &Hittable), Without<Dying>>,
        AiQuery,
    )>,
) {
    let dt = time.delta_secs().min(MAX_DT);
    chatter.clock += dt;
    snaps.clear();
    rocks.clear();
    rocks.extend(obstacles.iter().map(|(tf, o)| (tf.translation, o.radius)));
    for (e, tf, ship, ai, player, hit) in set.p0().iter() {
        snaps.push(Snap {
            e,
            pos: tf.translation,
            rot: tf.rotation,
            speed: ship.speed,
            team: ship.team,
            capital: ship.capital(),
            ghost: ship.def.ghost,
            radius: hit.radius,
            hit: *hit,
            torus: ship.def.torus,
            player: player.is_some(),
            target: player.map_or_else(|| ai.and_then(|a| a.target), |p| p.target),
            hunts_player: false,
            boost: ship.def.boost.unwrap_or(ship.def.speed),
        });
    }
    // second pass: who is chasing a player
    for i in 0..snaps.len() {
        if let Some(t) = snaps[i].target {
            snaps[i].hunts_player = snaps.iter().any(|o| o.e == t && o.player);
        }
    }
    let lead = snaps.iter().find(|s| s.player).copied();
    let player_targets = |e: Entity, snaps: &[Snap]| snaps.iter().any(|s| s.player && s.target == Some(e));

    for (e, tf, ship, mut ai, mut st, mut steer, mut trig, cruise) in set.p1().iter_mut() {
        *trig = Trigger::default();
        let pos = tf.translation;
        let f = tf.rotation * Vec3::Z;
        let def = &ship.def;

        // ---- capital ships: cruise or follow a destination (weapons.rs aims their turrets) ----
        if def.capital {
            let mut dir = f;
            // without a destination: hold course and the speed the ship was spawned with (carrier cruise)
            let mut want = ship.speed;
            if let Some(dest) = ai.dest {
                let to = dest - pos;
                let d = to.length();
                if d > 250.0 {
                    dir = to / d;
                    for c in snaps.iter() {
                        if c.e == e || !c.capital || c.ghost {
                            continue;
                        }
                        let away = pos - c.pos;
                        let dc = away.length();
                        if dc > 1.0 && dc < c.radius + ship.radius() + 80.0 {
                            dir = (dir + away / dc * 1.5).normalize_or(dir);
                        }
                    }
                    want = cruise.map_or(def.speed, |c| c.0);
                } else {
                    want = 0.0;
                }
            }
            *steer = Steer { dir, speed: want };
            continue;
        }

        // ---- ships with a fixed destination (fleeing courier): run, dodge capitals, never fight ----
        if let Some(dest) = ai.dest {
            let to = dest - pos;
            let mut dir = to.normalize_or(f);
            avoid_rocks(&rocks, pos, 90.0, &mut dir);
            avoid_hulls(&snaps, None, pos, &mut dir);
            *steer = Steer { dir, speed: cruise.map_or(ship.def.speed, |c| c.0) };
            continue;
        }

        // ---- fighters ----
        st.retarget -= dt;
        st.evade_t -= dt;
        let leash = if ai.wingman { lead.map(|l| l.pos) } else { None };
        let mut tgt = ai.target.and_then(|t| snaps.iter().find(|s| s.e == t)).filter(|s| s.e != e).copied();
        // the wingman lets a target go that drags him too far from the player
        if let (Some(t), Some(l)) = (tgt, leash) {
            if t.pos.distance_squared(l) > WING_LEASH * WING_LEASH * 1.3 {
                tgt = None;
            }
        }
        if tgt.is_none() || st.retarget <= 0.0 {
            tgt = pick_target(&snaps, e, pos, ship, leash, &ctx, &mut rng, &player_targets);
            ai.target = tgt.map(|t| t.e);
            st.retarget = rng.range(3.0, 6.0);
            // the wingman calls it when it peels an enemy off the player's tail
            if ai.wingman && tgt.is_some_and(|t| t.hunts_player) && chatter.clock - chatter.last_call > 25.0 && rng.f32() < 0.5 {
                chatter.last_call = chatter.clock;
                let line = *rng.pick(&[
                    "Einer an deinem Heck, {cs} – ich hol ihn runter!",
                    "Ich halte dir den Rücken frei. Du nimmst die vorne!",
                    "Hab den Verfolger. Konzentrier dich auf dein Ziel!",
                ]);
                comm.write(CommMsg { who: ai.who.clone().unwrap_or_default(), text: fill_callsign(line, &progress.callsign) });
            }
        }

        let def = &ship.def;
        let mut want = def.speed;
        let mut dir;
        match tgt {
            None => {
                if let (true, Some(l)) = (ai.wingman, lead) {
                    // formation on the player's left wing
                    let lf = l.rot * Vec3::Z;
                    let slot = l.pos + l.rot * Vec3::new(-28.0, 2.0, -22.0);
                    let to = slot - pos;
                    let d = to.length();
                    let boost = def.boost.unwrap_or(def.speed * 2.0);
                    if d < 30.0 {
                        dir = lf;
                        want = l.speed;
                    } else {
                        dir = (to / d).lerp(lf, if d < 120.0 { 0.5 } else { 0.0 }).normalize_or(lf);
                        want = if l.speed > l.boost || (d > 1200.0 && ctx.travel) {
                            IMPULSE_SPEED.min(l.speed + d * 1.2)
                        } else {
                            boost.min(l.speed + d * 1.2)
                        };
                    }
                } else {
                    // idle: wide lazy circle
                    dir = (f + tf.rotation * Vec3::X * 0.3).normalize();
                }
            }
            Some(t) => {
                let to = t.pos - pos;
                let dist = to.length();
                let break_d = t.radius + if t.capital { 150.0 } else { 55.0 };
                match st.mode {
                    Mode::Attack => {
                        // lead pursuit: aim where the target will be when a bolt gets there
                        let aim = if t.capital { to } else { to + (t.rot * Vec3::Z) * t.speed * dist / BOLT_SPEED };
                        dir = aim.normalize_or(f);
                        let dot = f.dot(dir);
                        if dist < break_d {
                            st.mode = Mode::Break;
                            st.t = rng.range(1.4, 2.8);
                            st.break_dir = (rng.dir() - dir * 0.4).normalize_or(-dir);
                        } else if dot > 0.993 && dist < 900.0 {
                            let spread = (1.0 - ai.skill) * 0.045 + if t.capital { 0.03 } else { 0.006 } + if ship.team == Team::Union { 0.018 } else { 0.0 };
                            let shot = (f + rng.dir() * spread).normalize();
                            trig.guns = true;
                            trig.aim = Some(pos + shot * dist);
                        }
                        st.msl_cool -= dt;
                        if ship.missiles > 0
                            && st.msl_cool <= 0.0
                            && dot > 0.96
                            && dist < 1500.0
                            && dist > 400.0
                            && !t.capital
                            && ship.team == Team::Aszendenz
                        {
                            st.msl_cool = rng.range(9.0, 16.0);
                            trig.missile = true;
                        }
                        if def.bomber && t.capital {
                            st.torp_cool -= dt;
                            if st.torp_cool <= 0.0 && dot > 0.95 && dist < 1300.0 {
                                st.torp_cool = rng.range(7.0, 10.0);
                                trig.missile = true;
                            }
                        }
                        want = if dist > 500.0 { def.speed } else { def.speed * 0.72 };
                        if st.evade_t > 0.0 && ai.skill > 0.3 {
                            dir = (dir + st.evade * 0.9).normalize_or(dir);
                        }
                    }
                    Mode::Break => {
                        st.t -= dt;
                        dir = st.break_dir;
                        if (st.t <= 0.0 && dist > break_d + 220.0) || st.t < -4.0 {
                            st.mode = Mode::Attack;
                        }
                    }
                }
            }
        }
        avoid_rocks(&rocks, pos, 70.0, &mut dir);
        avoid_hulls(&snaps, ai.target, pos, &mut dir);
        *steer = Steer { dir, speed: want };
    }
}

/// Web pickTarget(): nearest hostile with weights (enemy fighters hunt players, bombers go for capitals,
/// allies leave the player's own target alone and help whoever is on a player's tail).
#[allow(clippy::too_many_arguments)]
fn pick_target(
    snaps: &[Snap],
    me: Entity,
    pos: Vec3,
    ship: &Ship,
    leash: Option<Vec3>,
    ctx: &AiContext,
    rng: &mut AiRng,
    player_targets: &dyn Fn(Entity, &[Snap]) -> bool,
) -> Option<Snap> {
    let want_cap = ship.def.bomber;
    let mut best = None;
    let mut bd = f32::INFINITY;
    for o in snaps {
        if o.e == me || !ship.team.hostile_to(o.team) {
            continue;
        }
        let mut d = o.pos.distance(pos);
        if d > 6000.0 {
            continue;
        }
        if want_cap {
            let is_carrier = ctx.carrier == Some(o.e);
            if o.capital && (!is_carrier || d < 2500.0 || ctx.protect_carrier) {
                d *= 0.05;
            }
        } else if o.capital {
            d *= if ship.team == Team::Union { 2.2 } else { 4.0 };
        }
        if o.player {
            d *= if ship.team == Team::Aszendenz && !want_cap { 0.28 } else { 0.75 };
        }
        // the wingman fights near the player: far fights are left alone, nearer ones are preferred
        if let Some(l) = leash {
            let dl = o.pos.distance(l);
            if dl > WING_LEASH {
                continue;
            }
            d += dl * 0.5;
        }
        if ship.team == Team::Union && !o.capital {
            if player_targets(o.e, snaps) {
                d *= 3.0;
            }
            if o.hunts_player {
                d *= if leash.is_some() { 0.45 } else { 0.7 };
            }
        }
        d *= rng.range(0.8, 1.2);
        if d < bd {
            bd = d;
            best = Some(*o);
        }
    }
    best
}

/// Push the flight direction away from capital hulls closer than 60 m (except the ship being attacked).
fn avoid_hulls(snaps: &[Snap], target: Option<Entity>, pos: Vec3, dir: &mut Vec3) {
    for c in snaps {
        if !c.capital || c.ghost || Some(c.e) == target {
            continue;
        }
        if pos.distance_squared(c.pos) > (c.radius + 120.0).powi(2) {
            continue;
        }
        let tf = Transform::from_translation(c.pos).with_rotation(c.rot);
        let (d, push) = hull_distance(&tf, &c.hit, c.torus, pos);
        if d < 60.0 {
            *dir = (*dir + push * 3.0).normalize_or(*dir);
        }
    }
}

/// Steer around asteroids (and mines) closer than `margin` to their surface.
fn avoid_rocks(rocks: &[(Vec3, f32)], pos: Vec3, margin: f32, dir: &mut Vec3) {
    for &(c, r) in rocks {
        let away = pos - c;
        let d = away.length();
        if d < r + margin && d > 1e-3 {
            *dir = (*dir + away / d * 2.5 * (1.0 - (d - r) / margin).min(1.5)).normalize_or(*dir);
        }
    }
}

/// SF_AI_LOG: every 3 s one line per AI fighter (mode, target, distance, speed, firing).
fn log_ai(
    time: Res<Time>,
    mut t: Local<f32>,
    q: Query<(&Transform, &Ship, &Ai, &AiState, &Steer, &Trigger), Without<Dying>>,
    all: Query<(&Transform, &Ship)>,
) {
    *t -= time.delta_secs();
    if *t > 0.0 {
        return;
    }
    *t = 3.0;
    for (tf, ship, ai, st, steer, trig) in &q {
        if ship.capital() {
            continue;
        }
        let tgt = ai.target.and_then(|e| all.get(e).ok());
        println!(
            "[ai] {:<14} {:?} skill {:.2} -> {:<14} {:>5.0} m  speed {:>4.0}/{:>4.0}  facing {:.2}  guns {} msl {}{}",
            ship.name,
            st.mode,
            ai.skill,
            tgt.map_or("-", |t| t.1.name.as_str()),
            tgt.map_or(0.0, |t| t.0.translation.distance(tf.translation)),
            ship.speed,
            steer.speed,
            (tf.rotation * Vec3::Z).dot(steer.dir),
            trig.guns,
            ship.missiles,
            if ai.wingman { "  [wingman]" } else { "" }
        );
    }
}
