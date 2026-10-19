use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use song_core::{Action, GameState, Phase, PlayerView, Placed, PLAYERS};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::{self, UnboundedSender};

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMsg {
    NewSeries { cards: Vec<Placed> },
    Extend { series: usize, cards: Vec<Placed> },
    NextRound,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMsg {
    Waiting { seat: usize, joined: usize },
    State { view: PlayerView, totals: [i32; PLAYERS] },
    Error { message: String },
}

#[derive(Default)]
struct Room {
    seats: [Option<UnboundedSender<ServerMsg>>; PLAYERS],
    game: Option<GameState>,
    totals: [i32; PLAYERS], // skor kumulatif antar ronde
    scored: bool,           // hasil ronde ini sudah dijumlahkan ke totals?
}

type Shared = Arc<Mutex<Room>>;

#[tokio::main]
async fn main() {
    let room: Shared = Arc::new(Mutex::new(Room::default()));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(ws_handler))
        .with_state(room);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    println!("Server jalan di http://localhost:3001");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(room): State<Shared>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, room))
}

/// Mulai ronde baru. Ronde berikutnya dimulai oleh pemain tepat di bawah
/// pemain dengan skor total terkecil (arah: kursi berikutnya).
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

/// Mulai game kalau 5 kursi terisi, lalu kirim tampilan masing-masing ke tiap pemain.
fn broadcast(r: &mut Room) {
    let joined = r.seats.iter().filter(|s| s.is_some()).count();
    if r.game.is_none() && joined == PLAYERS {
        start_round(r);
    }
    settle(r);

    for (i, s) in r.seats.iter().enumerate() {
        if let Some(tx) = s {
            let msg = match &r.game {
                Some(g) => ServerMsg::State { view: g.view_for(i), totals: r.totals },
                None => ServerMsg::Waiting { seat: i, joined },
            };
            let _ = tx.send(msg);
        }
    }
}

fn apply(r: &mut Room, seat: usize, action: Action) -> Result<(), String> {
    match r.game.as_mut() {
        Some(g) => g.apply(seat, action).map_err(|e| format!("{e:?}")),
        None => Err("Game belum dimulai".to_string()),
    }
}

fn to_text(msg: &ServerMsg) -> Message {
    Message::Text(serde_json::to_string(msg).unwrap())
}

async fn handle_socket(socket: WebSocket, room: Shared) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();

    // ambil kursi kosong pertama
    let seat = {
        let mut r = room.lock().unwrap();
        let free = r.seats.iter().position(|s| s.is_none());
        if let Some(i) = free {
            r.seats[i] = Some(tx.clone());
        }
        free
    };
    let Some(seat) = seat else {
        let _ = ws_tx
            .send(to_text(&ServerMsg::Error { message: "Room penuh".into() }))
            .await;
        return;
    };

    // task penulis: kirim apa pun dari channel ke socket
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(to_text(&msg)).await.is_err() {
                break;
            }
        }
    });

    broadcast(&mut room.lock().unwrap());

    // loop pembaca: terima aksi dari pemain
    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else { continue };
        let mut guard = room.lock().unwrap();
        let r = &mut *guard;

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
        };

        match result {
            Ok(()) => broadcast(r),
            Err(message) => {
                if let Some(tx) = &r.seats[seat] {
                    let _ = tx.send(ServerMsg::Error { message });
                }
            }
        }
    }

    // pemain keluar: kosongkan kursi
    {
        let mut r = room.lock().unwrap();
        r.seats[seat] = None;
        if r.seats.iter().all(|s| s.is_none()) {
            r.game = None; // semua keluar, reset
            r.totals = [0; PLAYERS];
            r.scored = false;
        }
    }
    writer.abort();
}