use serde::{Deserialize, Serialize};
use song_core::{Action, Card, GameState, Placed, PLAYERS};
use wasm_bindgen::prelude::*;

/// Pesan aksi dari client (format sama dengan yang dikirim React).
#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientAction {
    NewSeries { cards: Vec<Placed> },
    Extend { series: usize, cards: Vec<Placed> },
    Kill { cards: Vec<Card> },
    Revive { set: usize, dead: Placed, helper: Placed, series: usize },
    AddDead { set: usize, cards: Vec<Card> },
}

#[derive(Serialize)]
struct ApplyOut {
    error: Option<String>,
    state: Option<GameState>,
}

/// Game baru. starter < 0 = ditentukan otomatis (ronde pertama).
/// Mengembalikan state sebagai JSON.
#[wasm_bindgen]
pub fn new_game(seed_hi: u32, seed_lo: u32, starter: i32) -> String {
    let seed = ((seed_hi as u64) << 32) | seed_lo as u64;
    let starter = if (0..PLAYERS as i32).contains(&starter) {
        Some(starter as usize)
    } else {
        None
    };
    serde_json::to_string(&GameState::new_seeded(seed, starter)).unwrap()
}

fn apply_inner(state_json: &str, seat: usize, msg_json: &str) -> Result<GameState, String> {
    if seat >= PLAYERS {
        return Err("Kursi tidak valid".into());
    }
    let mut g: GameState =
        serde_json::from_str(state_json).map_err(|e| format!("State rusak: {e}"))?;
    let msg: ClientAction =
        serde_json::from_str(msg_json).map_err(|_| "Pesan tidak dikenali".to_string())?;
    let action = match msg {
        ClientAction::NewSeries { cards } => Action::NewSeries { cards },
        ClientAction::Extend { series, cards } => Action::Extend { series, cards },
        ClientAction::Kill { cards } => Action::Kill { cards },
        ClientAction::Revive { set, dead, helper, series } => {
            Action::Revive { set, dead, helper, series }
        }
        ClientAction::AddDead { set, cards } => Action::AddDead { set, cards },
    };
    g.apply(seat, action).map_err(|e| format!("{e:?}"))?;
    Ok(g)
}

/// Terapkan aksi. Hasil JSON: {"error": string|null, "state": object|null}.
#[wasm_bindgen]
pub fn apply(state_json: &str, seat: usize, msg_json: &str) -> String {
    let out = match apply_inner(state_json, seat, msg_json) {
        Ok(g) => ApplyOut { error: None, state: Some(g) },
        Err(e) => ApplyOut { error: Some(e), state: None },
    };
    serde_json::to_string(&out).unwrap()
}

/// Tampilan untuk satu pemain (kartu lawan disembunyikan), JSON.
#[wasm_bindgen]
pub fn view_for(state_json: &str, seat: usize) -> String {
    match serde_json::from_str::<GameState>(state_json) {
        Ok(g) if seat < PLAYERS => serde_json::to_string(&g.view_for(seat)).unwrap(),
        _ => "null".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_errors() {
        let json = new_game(1, 2, -1);
        let g: GameState = serde_json::from_str(&json).unwrap();
        assert!(g.hands.iter().all(|h| h.len() == 20));

        // seed sama = kocokan sama
        assert_eq!(new_game(1, 2, -1), json);

        let bad = apply(&json, 0, r#"{"type":"Bogus"}"#);
        assert!(bad.contains("Pesan tidak dikenali"));

        let v = view_for(&json, 3);
        assert!(v.contains("\"seat\":3"));
        assert_eq!(view_for(&json, 9), "null");
    }
}