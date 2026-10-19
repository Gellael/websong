use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::{Deserialize, Serialize};
use song_core::{Action, Card, GameState, Phase, Placed, PlayerView, PLAYERS};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::mpsc::{self, UnboundedSender};

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    NewSeries { cards: Vec<Placed> },
    Extend { series: usize, cards: Vec<Placed> },
    NextRound,
    Kill { cards: Vec<Card> },
    Revive { set: usize, dead: Placed, helper: Placed, series: usize },
    AddDead { set: usize, cards: Vec<Card> },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMsg {
    Joined { token: String, seat: usize },
    JoinFailed { message: String },
    Waiting { seat: usize, joined: usize, names: [String; PLAYERS] },
    State {
        view: PlayerView,
        totals: [i32; PLAYERS],
        names: [String; PLAYERS],
        online: [bool; PLAYERS],
    },
    Error { message: String },
}

#[derive(Deserialize)]
struct JoinQuery {
    room: String,
    name: String,
    token: Option<String>,
}

struct Seat {
    token: String,
    name: String,
    tx: Option<UnboundedSender<ServerMsg>>, // None = sedang terputus
}

#[derive(Default)]
struct Room {
    seats: [Option<Seat>; PLAYERS],
    game: Option<GameState>,
    totals: [i32; PLAYERS],
    scored: bool,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

#[tokio::main]
async fn main() {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .with_state(rooms);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("Server jalan di http://localhost:3001");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<JoinQuery>,
    State(rooms): State<Rooms>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, rooms, q))
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

/// Jumlahkan skor ronde ke total, tepat satu kali per ronde.
fn settle(r: &mut Room) {
    if r.scored {
        return;
    }
    if let Some(g) = &r.game {
        if g.phase == Phase::Over {
            if let Some(res) = &g.result {
                for i in 0..PLAYERS {
                    r.totals[i] += res.scores[i];
                }
                r.scored = true;
            }
        }
    }
}

fn broadcast(r: &mut Room) {
    let joined = r.seats.iter().filter(|s| s.is_some()).count();
    if r.game.is_none() && joined == PLAYERS {
        start_round(r);
    }
    settle(r);

    let names: [String; PLAYERS] = std::array::from_fn(|i| {
        r.seats[i].as_ref().map(|s| s.name.clone()).unwrap_or_default()
    });
    let online: [bool; PLAYERS] =
        std::array::from_fn(|i| r.seats[i].as_ref().map_or(false, |s| s.tx.is_some()));

    for i in 0..PLAYERS {
        let Some(seat) = &r.seats[i] else { continue };
        let Some(tx) = &seat.tx else { continue };
        let msg = match &r.game {
            Some(g) => ServerMsg::State {
                view: g.view_for(i),
                totals: r.totals,
                names: names.clone(),
                online,
            },
            None => ServerMsg::Waiting { seat: i, joined, names: names.clone() },
        };
        let _ = tx.send(msg);
    }
}

fn apply(r: &mut Room, seat: usize, action: Action) -> Result<(), String> {
    match r.game.as_mut() {
        Some(g) => g.apply(seat, action).map_err(|e| format!("{e:?}")),
        None => Err("Game belum dimulai".to_string()),
    }
}

fn all_offline(r: &Room) -> bool {
    r.seats.iter().all(|s| s.as_ref().map_or(true, |s| s.tx.is_none()))
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
        let r = map.entry(code.clone()).or_default();

        let existing = q.token.as_ref().and_then(|t| {
            r.seats
                .iter()
                .position(|s| s.as_ref().map_or(false, |s| &s.token == t))
        });

        if let Some(i) = existing {
            let s = r.seats[i].as_mut().unwrap();
            s.tx = Some(tx.clone());
            Ok((i, s.token.clone()))
        } else if r.game.is_some() {
            Err("Permainan di room ini sudah berjalan")
                } else if let Some(i) = r.seats.iter().position(|s| s.is_none()) {
            let token = q
                .token
                .clone()
                .filter(|t| (16..=64).contains(&t.len()))
                .unwrap_or_else(new_token);
            r.seats[i] = Some(Seat { token: token.clone(), name, tx: Some(tx.clone()) });
            Ok((i, token))
        } else {
            Err("Room penuh")
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

    // task penulis: kirim apa pun dari channel ke socket
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(to_text(&msg)).await.is_err() {
                break;
            }
        }
    });

    let _ = tx.send(ServerMsg::Joined { token, seat });
    {
        let mut map = rooms.lock().unwrap();
        if let Some(r) = map.get_mut(&code) {
            broadcast(r);
        }
    }

    // loop pembaca: terima aksi dari pemain
    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else { continue };
        let mut map = rooms.lock().unwrap();
        let Some(r) = map.get_mut(&code) else { break };

        let result = match serde_json::from_str::<ClientMsg>(&text) {
            Err(_) => Err("Pesan tidak dikenali".to_string()),
            Ok(ClientMsg::NextRound) => {
                let over = r.game.as_ref().map_or(false, |g| g.phase == Phase::Over);
                if over {
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
            Ok(ClientMsg::Revive { set, dead, helper, series }) => {
                apply(r, seat, Action::Revive { set, dead, helper, series })
            }
            Ok(ClientMsg::AddDead { set, cards }) => apply(r, seat, Action::AddDead { set, cards }),
        };

        match result {
            Ok(()) => broadcast(r),
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
                } else if let Some(s) = r.seats[seat].as_mut() {
                    s.tx = None; // sudah mulai: pertahankan kursi
                }
                broadcast(r);
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