use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use song_core::{bot, Action, Card, GameState, Phase, Placed, PlayerView, PLAYERS};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc::{self, UnboundedSender};

/// Total room yang boleh ada di server sekaligus.
const MAX_ROOMS: usize = 50;
/// Jumlah meja yang ditampilkan di daftar halaman utama.
const MAX_LISTED: usize = 8;
/// Jeda bot sebelum melangkah, supaya gerakannya bisa diikuti pemain.
const BOT_DELAY_MS: u64 = 900;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    Ping,
    StartGame {
        #[serde(rename = "scoreLimit")]
        #[allow(dead_code)]
        score_limit: Option<i32>,
    },
    NewSeries { cards: Vec<Placed> },
    Extend { series: usize, cards: Vec<Placed> },
    Kill { cards: Vec<Card> },
    AddDead { set: usize, cards: Vec<Card> },
    ReviveDead { set: usize, jokers: Vec<Card> },
    NextRound,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMsg {
    Joined { token: String, seat: usize },
    JoinFailed { message: String },
    Waiting {
        seat: usize,
        joined: usize,
        names: [String; PLAYERS],
        #[serde(rename = "isHost")]
        is_host: bool,
        #[serde(rename = "scoreLimit")]
        score_limit: i32,
    },
    State {
        view: PlayerView,
        totals: [i32; PLAYERS],
        names: [String; PLAYERS],
        online: [bool; PLAYERS],
        bots: [bool; PLAYERS],
        #[serde(rename = "scoreLimit")]
        score_limit: i32,
        #[serde(rename = "gameOver")]
        game_over: bool,
        #[serde(rename = "gameWinner")]
        game_winner: Option<usize>,
    },
    Error { message: String },
}

#[derive(Serialize)]
struct TableInfo {
    room: String,
    host: String,
    joined: usize,
    #[serde(rename = "scoreLimit")]
    score_limit: i32,
    status: &'static str, // "waiting" | "playing"
}

#[derive(Deserialize)]
struct JoinQuery {
    room: String,
    name: String,
    token: Option<String>,
    /// Batas skor, hanya dipakai saat room dibuat (0 / kosong = tanpa batas).
    limit: Option<i32>,
    /// "1" = tampil di daftar meja, hanya dipakai saat room dibuat.
    public: Option<String>,
}

struct Seat {
    token: String,
    name: String,
    tx: Option<UnboundedSender<ServerMsg>>, // None = terputus (atau bot)
    bot: bool,
}

#[derive(Default)]
struct Room {
    seats: [Option<Seat>; PLAYERS],
    game: Option<GameState>,
    totals: [i32; PLAYERS],
    scored: bool,
    host: usize,
    public: bool,
    score_limit: i32,
    game_over: bool,
    game_winner: Option<usize>,
    bot_pending: bool,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

#[tokio::main]
async fn main() {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .route("/rooms", get(list_rooms))
        .with_state(rooms);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    println!("Server jalan di port {port}");
    axum::serve(listener, app).await.unwrap();
}

fn origin_ok(headers: &HeaderMap) -> bool {
    // Kalau ALLOWED_ORIGINS tidak diisi (development), semua asal diizinkan.
    let Ok(allowed) = std::env::var("ALLOWED_ORIGINS") else {
        return true;
    };
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    allowed.split(',').any(|a| a.trim() == origin)
}

/// Nilai header CORS untuk endpoint HTTP biasa (/rooms).
fn cors_origin(headers: &HeaderMap) -> Option<String> {
    let Ok(allowed) = std::env::var("ALLOWED_ORIGINS") else {
        return Some("*".to_string());
    };
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())?;
    allowed
        .split(',')
        .any(|a| a.trim() == origin)
        .then(|| origin.to_string())
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(q): Query<JoinQuery>,
    State(rooms): State<Rooms>,
) -> axum::response::Response {
    if !origin_ok(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, rooms, q))
        .into_response()
}

/// Daftar meja publik: maksimal MAX_LISTED, yang masih menunggu ditaruh di atas.
async fn list_rooms(headers: HeaderMap, State(rooms): State<Rooms>) -> impl IntoResponse {
    let mut out: Vec<TableInfo> = {
        let map = rooms.lock().unwrap();
        map.iter()
            .filter(|(_, r)| r.public && !r.game_over && humans_online(r))
            .map(|(code, r)| TableInfo {
                room: code.clone(),
                host: r.seats[r.host]
                    .as_ref()
                    .map(|s| s.name.clone())
                    .unwrap_or_default(),
                joined: r.seats.iter().filter(|s| s.is_some()).count(),
                score_limit: r.score_limit,
                status: if r.game.is_none() { "waiting" } else { "playing" },
            })
            .collect()
    };
    out.sort_by(|a, b| {
        (b.status == "waiting")
            .cmp(&(a.status == "waiting"))
            .then(b.joined.cmp(&a.joined))
            .then(a.room.cmp(&b.room))
    });
    out.truncate(MAX_LISTED);

    let mut h = HeaderMap::new();
    if let Some(o) = cors_origin(&headers) {
        if let Ok(v) = HeaderValue::from_str(&o) {
            h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
        }
    }
    h.insert(header::VARY, HeaderValue::from_static("Origin"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    (h, Json(out))
}

fn new_token() -> String {
    let mut rng = rand::thread_rng();
    format!("{:016x}{:016x}", rng.r#gen::<u64>(), rng.r#gen::<u64>())
}

/// Ronde berikutnya dimulai oleh pemain tepat di bawah pemain dengan skor total terkecil.
fn start_round(r: &mut Room) {
    let starter = if r.game.is_some() {
        let lowest = (0..PLAYERS).min_by_key(|&i| r.totals[i]).unwrap();
        Some((lowest + 1) % PLAYERS)
    } else {
        None
    };
    r.game = Some(GameState::new(&mut rand::thread_rng(), starter));
    r.scored = false;
}

/// Jumlahkan skor ronde ke total (sekali per ronde) dan cek batas skor.
fn settle(r: &mut Room) {
    if r.scored {
        return;
    }
    let scores = match &r.game {
        Some(g) if g.phase == Phase::Over => g.result.as_ref().map(|x| x.scores),
        _ => None,
    };
    if let Some(sc) = scores {
        for i in 0..PLAYERS {
            r.totals[i] += sc[i];
        }
        r.scored = true;
        if r.score_limit > 0 && r.totals.iter().any(|&t| t >= r.score_limit) {
            r.game_over = true;
            r.game_winner = (0..PLAYERS).min_by_key(|&i| (r.totals[i], i));
        }
    }
}

fn broadcast(r: &mut Room) {
    settle(r);
    let joined = r.seats.iter().filter(|s| s.is_some()).count();

    let names: [String; PLAYERS] = std::array::from_fn(|i| {
        r.seats[i].as_ref().map(|s| s.name.clone()).unwrap_or_default()
    });
    let online: [bool; PLAYERS] = std::array::from_fn(|i| {
        r.seats[i].as_ref().map_or(false, |s| s.bot || s.tx.is_some())
    });
    let bots: [bool; PLAYERS] =
        std::array::from_fn(|i| r.seats[i].as_ref().map_or(false, |s| s.bot));

    for i in 0..PLAYERS {
        let Some(seat) = &r.seats[i] else { continue };
        let Some(tx) = &seat.tx else { continue };
        let msg = match &r.game {
            Some(g) => ServerMsg::State {
                view: g.view_for(i),
                totals: r.totals,
                names: names.clone(),
                online,
                bots,
                score_limit: r.score_limit,
                game_over: r.game_over,
                game_winner: r.game_winner,
            },
            None => ServerMsg::Waiting {
                seat: i,
                joined,
                names: names.clone(),
                is_host: i == r.host,
                score_limit: r.score_limit,
            },
        };
        let _ = tx.send(msg);
    }
}

/// Ada minimal satu pemain manusia yang sedang terhubung.
fn humans_online(r: &Room) -> bool {
    r.seats
        .iter()
        .any(|s| s.as_ref().map_or(false, |s| !s.bot && s.tx.is_some()))
}

fn all_offline(r: &Room) -> bool {
    !humans_online(r)
}

/// Satu langkah bot. Bot memainkan kursi bot, dan juga kursi pemain yang terputus.
fn bot_step(r: &mut Room) -> bool {
    let auto: [bool; PLAYERS] = std::array::from_fn(|i| {
        r.seats[i].as_ref().map_or(false, |s| s.bot || s.tx.is_none())
    });
    let Some(g) = r.game.as_mut() else { return false };
    match g.phase {
        Phase::Over => false,
        Phase::Opening => {
            for seat in 0..PLAYERS {
                if auto[seat] && g.alive[seat] {
                    if let Some(a) = bot::choose(g, seat) {
                        if g.apply(seat, a).is_ok() {
                            return true;
                        }
                    }
                }
            }
            false
        }
        Phase::Playing => {
            let t = g.turn;
            if !auto[t] {
                return false;
            }
            match bot::choose(g, t) {
                Some(a) => g.apply(t, a).is_ok(),
                None => false,
            }
        }
    }
}

fn spawn_bots(rooms: Rooms, code: String) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(BOT_DELAY_MS)).await;
            let mut map = rooms.lock().unwrap();
            let Some(r) = map.get_mut(&code) else { return };
            if !humans_online(r) || !bot_step(r) {
                r.bot_pending = false;
                return;
            }
            broadcast(r);
        }
    });
}

fn kick_bots(rooms: &Rooms, code: &str, r: &mut Room) {
    if r.bot_pending || !humans_online(r) {
        return;
    }
    let active = r.game.as_ref().map_or(false, |g| g.phase != Phase::Over);
    if !active {
        return;
    }
    r.bot_pending = true;
    spawn_bots(rooms.clone(), code.to_string());
}

/// Kirim state terbaru ke semua pemain, lalu jalankan bot kalau perlu.
fn push(rooms: &Rooms, code: &str, r: &mut Room) {
    broadcast(r);
    kick_bots(rooms, code, r);
}

fn apply(r: &mut Room, seat: usize, action: Action) -> Result<(), String> {
    if r.game_over {
        return Err("Permainan sudah selesai".to_string());
    }
    match r.game.as_mut() {
        Some(g) => g.apply(seat, action).map_err(|e| format!("{e:?}")),
        None => Err("Game belum dimulai".to_string()),
    }
}

fn to_text(msg: &ServerMsg) -> Message {
    Message::Text(serde_json::to_string(msg).unwrap())
}

async fn handle_socket(socket: WebSocket, rooms: Rooms, q: JoinQuery) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();

    let code: String = q.room.trim().to_uppercase().chars().take(12).collect();
    let mut name: String = q.name.trim().chars().take(16).collect();
    if name.is_empty() {
        name = "Pemain".to_string();
    }

    // cari kursi: sambung ulang lewat token, atau ambil kursi kosong
    let joined: Result<(usize, String), &'static str> = if code.is_empty() {
        Err("Kode room kosong")
    } else {
        let mut map = rooms.lock().unwrap();
        let is_new = !map.contains_key(&code);

        if is_new && map.len() >= MAX_ROOMS {
            Err("Server penuh, coba lagi nanti")
        } else {
            let limit = q.limit.unwrap_or(0).clamp(0, 10_000);
            let limit = if limit > 0 { limit.max(50) } else { 0 };
            let public = q.public.as_deref() == Some("1");

            let r = map.entry(code.clone()).or_insert_with(|| Room {
                public,
                score_limit: limit,
                ..Default::default()
            });

            let existing = q.token.as_ref().and_then(|t| {
                r.seats
                    .iter()
                    .position(|s| s.as_ref().map_or(false, |s| !s.bot && &s.token == t))
            });

            if let Some(i) = existing {
                let s = r.seats[i].as_mut().unwrap();
                s.tx = Some(tx.clone());
                Ok((i, s.token.clone()))
            } else if r.game.is_some() {
                Err("Permainan di room ini sudah berjalan")
            } else if let Some(i) = r.seats.iter().position(|s| s.is_none()) {
                if r.seats.iter().all(|s| s.is_none()) {
                    r.host = i; // pemain pertama = pembuat room
                }
                let token = q
                    .token
                    .clone()
                    .filter(|t| (16..=64).contains(&t.len()))
                    .unwrap_or_else(new_token);
                r.seats[i] = Some(Seat {
                    token: token.clone(),
                    name,
                    tx: Some(tx.clone()),
                    bot: false,
                });
                Ok((i, token))
            } else {
                Err("Room penuh")
            }
        }
    };

    let (seat, token) = match joined {
        Ok(v) => v,
        Err(message) => {
            let _ = ws_tx
                .send(to_text(&ServerMsg::JoinFailed { message: message.into() }))
                .await;
            return;
        }
    };

    // task penulis: kirim pesan dari channel ke socket, plus ping berkala
    // supaya koneksi yang diam tidak diputus oleh proxy
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(Duration::from_secs(25));
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    let Some(msg) = msg else { break };
                    if ws_tx.send(to_text(&msg)).await.is_err() {
                        break;
                    }
                }
                _ = ping.tick() => {
                    if ws_tx.send(Message::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let _ = tx.send(ServerMsg::Joined { token, seat });
    {
        let mut map = rooms.lock().unwrap();
        if let Some(r) = map.get_mut(&code) {
            push(&rooms, &code, r);
        }
    }

    // loop pembaca: terima aksi dari pemain
    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else { continue };
        let mut map = rooms.lock().unwrap();
        let Some(r) = map.get_mut(&code) else { break };

        let result = match serde_json::from_str::<ClientMsg>(&text) {
            Err(_) => Err("Pesan tidak dikenali".to_string()),
            Ok(ClientMsg::Ping) => continue,
            Ok(ClientMsg::StartGame { .. }) => {
                let joined = r.seats.iter().filter(|s| s.is_some()).count();
                if r.game.is_some() {
                    Err("Permainan sudah dimulai".to_string())
                } else if seat != r.host {
                    Err("Hanya pembuat room yang bisa memulai".to_string())
                } else if joined < 2 {
                    Err("Minimal 2 pemain untuk memulai".to_string())
                } else {
                    // kursi kosong diisi bot
                    for i in 0..PLAYERS {
                        if r.seats[i].is_none() {
                            r.seats[i] = Some(Seat {
                                token: String::new(),
                                name: format!("Bot {}", i + 1),
                                tx: None,
                                bot: true,
                            });
                        }
                    }
                    start_round(r);
                    Ok(())
                }
            }
            Ok(ClientMsg::NextRound) => {
                let over = r.game.as_ref().map_or(false, |g| g.phase == Phase::Over);
                if r.game_over {
                    Err("Permainan sudah selesai".to_string())
                } else if over {
                    start_round(r);
                    Ok(())
                } else {
                    Err("Ronde belum selesai".to_string())
                }
            }
            Ok(ClientMsg::NewSeries { cards }) => apply(r, seat, Action::NewSeries { cards }),
            Ok(ClientMsg::Extend { series, cards }) => {
                apply(r, seat, Action::Extend { series, cards })
            }
            Ok(ClientMsg::Kill { cards }) => apply(r, seat, Action::Kill { cards }),
            Ok(ClientMsg::AddDead { set, cards }) => {
                apply(r, seat, Action::AddDead { set, cards })
            }
            Ok(ClientMsg::ReviveDead { set, jokers }) => {
                apply(r, seat, Action::ReviveDead { set, jokers })
            }
        };

        match result {
            Ok(()) => push(&rooms, &code, r),
            Err(message) => {
                let _ = tx.send(ServerMsg::Error { message });
            }
        }
    }

    // koneksi terputus
    {
        let mut map = rooms.lock().unwrap();
        let mut offline = false;
        let mut started = false;
        if let Some(r) = map.get_mut(&code) {
            // hanya proses kalau koneksi ini masih yang aktif di kursinya
            // (refresh membuat koneksi baru sebelum yang lama tertutup)
            let is_current = r.seats[seat]
                .as_ref()
                .and_then(|s| s.tx.as_ref())
                .map_or(false, |t| t.same_channel(&tx));
            if is_current {
                if r.game.is_none() {
                    r.seats[seat] = None; // belum mulai: bebaskan kursi
                    if seat == r.host {
                        if let Some(n) = r.seats.iter().position(|s| s.is_some()) {
                            r.host = n; // pembuat room pindah ke pemain lain
                        }
                    }
                } else if let Some(s) = r.seats[seat].as_mut() {
                    s.tx = None; // sudah mulai: pertahankan kursi, bot menggantikan sementara
                }
                push(&rooms, &code, r);
                offline = all_offline(r);
                started = r.game.is_some();
            }
        }
        if offline {
            if started {
                // beri waktu 10 menit untuk kembali sebelum room dihapus
                let rooms2 = rooms.clone();
                let code2 = code.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(600)).await;
                    let mut map = rooms2.lock().unwrap();
                    let still_offline = map.get(&code2).map_or(false, all_offline);
                    if still_offline {
                        map.remove(&code2);
                    }
                });
            } else {
                map.remove(&code);
            }
        }
    }
    writer.abort();
}