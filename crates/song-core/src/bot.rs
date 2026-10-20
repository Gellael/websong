//! Bot pengganti pemain yang keluar.
//!
//! Bot hanya memakai informasi yang boleh dilihat pemain: kartunya sendiri, meja,
//! kartu mati, dan status pemain. Setiap kandidat langkah dicoba pada SALINAN state
//! memakai aturan asli (`GameState::apply`), jadi bot tidak mungkin mengirim langkah
//! yang tidak sah, dan aturan tidak perlu ditulis ulang di sini.

use crate::game::{Action, GameState, Outcome, Phase};
use crate::series::{can_add_dead, can_extend, can_kill, can_open, DeadSet, Placed, Series};
use crate::{Card, Suit, PLAYERS};

const SUITS: [Suit; 4] = [Suit::Diamonds, Suit::Clubs, Suit::Hearts, Suit::Spades];

/// Joker yang dipakai dianggap "mahal": hanya dikeluarkan kalau memberi keuntungan jelas.
const JOKER_COST: i32 = 20;

fn rank_at(pos: u8) -> u8 {
    if pos == 14 {
        1
    } else {
        pos
    }
}

fn points(hand: &[Card]) -> i32 {
    hand.iter().map(|c| c.points()).sum()
}

fn joker_count(hand: &[Card]) -> i32 {
    hand.iter().filter(|c| c.is_joker()).count() as i32
}

/// Kartu asli (bukan joker) dengan jenis dan posisi tertentu yang belum dipakai.
fn natural(hand: &[Card], used: &[u8], suit: Suit, pos: u8) -> Option<Card> {
    hand.iter().copied().find(|c| {
        !c.is_joker() && c.suit == suit && c.rank == rank_at(pos) && !used.contains(&c.id)
    })
}

/// Isi posisi-posisi untuk jenis `suit`: kartu asli kalau ada, joker kalau tidak.
/// None kalau joker kurang (atau tidak ada kartu asli padahal dibutuhkan).
fn fill(hand: &[Card], suit: Suit, positions: &[u8], need_natural: bool) -> Option<Vec<Placed>> {
    let mut used: Vec<u8> = Vec::new();
    let mut spare: Vec<Card> = hand.iter().copied().filter(|c| c.is_joker()).collect();
    let mut out = Vec::with_capacity(positions.len());
    let mut naturals = 0;
    for &pos in positions {
        if let Some(card) = natural(hand, &used, suit, pos) {
            used.push(card.id);
            naturals += 1;
            out.push(Placed { card, pos });
        } else {
            let card = spare.pop()?;
            out.push(Placed { card, pos });
        }
    }
    if need_natural && naturals == 0 {
        return None;
    }
    Some(out)
}

/// Semua seri baru (3..=5 kartu) yang bisa dibentuk dari tangan.
fn series_candidates(hand: &[Card]) -> Vec<Vec<Placed>> {
    let mut out = Vec::new();
    for suit in SUITS {
        for start in 1..=12u8 {
            for len in 3..=5u8 {
                let end = start + len - 1;
                if end > 14 {
                    break;
                }
                let positions: Vec<u8> = (start..=end).collect();
                if let Some(cards) = fill(hand, suit, &positions, true) {
                    out.push(cards);
                }
            }
        }
    }
    out
}

/// Semua cara menyambung seri yang ada di meja dengan 1 atau 2 kartu.
fn extend_candidates(hand: &[Card], table: &[Series]) -> Vec<(usize, Vec<Placed>)> {
    let mut out = Vec::new();
    for (i, s) in table.iter().enumerate() {
        let (lo, hi) = (s.lo(), s.hi());
        let mut options: Vec<Vec<u8>> = Vec::new();
        if lo > 1 {
            options.push(vec![lo - 1]);
        }
        if hi < 14 {
            options.push(vec![hi + 1]);
        }
        if lo > 2 {
            options.push(vec![lo - 2, lo - 1]);
        }
        if hi < 13 {
            options.push(vec![hi + 1, hi + 2]);
        }
        if lo > 1 && hi < 14 {
            options.push(vec![lo - 1, hi + 1]);
        }
        for positions in options {
            if let Some(cards) = fill(hand, s.suit, &positions, false) {
                out.push((i, cards));
            }
        }
    }
    out
}

/// Kartu mati: 3..=5 kartu seangka (joker boleh mengisi, minimal satu kartu asli).
fn kill_candidates(hand: &[Card]) -> Vec<Vec<Card>> {
    let js: Vec<Card> = hand.iter().copied().filter(|c| c.is_joker()).collect();
    let mut out = Vec::new();
    for rank in 1..=13u8 {
        let nat: Vec<Card> = hand
            .iter()
            .copied()
            .filter(|c| !c.is_joker() && c.rank == rank)
            .collect();
        if nat.is_empty() {
            continue;
        }
        for size in 3..=5usize {
            if nat.len() >= size {
                out.push(nat[..size].to_vec());
            } else if nat.len() + js.len() >= size {
                let mut cards = nat.clone();
                cards.extend(js.iter().take(size - nat.len()).copied());
                out.push(cards);
            }
        }
    }
    out
}

/// Menambah 1..=2 kartu seangka ke set kartu mati yang sudah ada.
fn add_dead_candidates(hand: &[Card], sets: &[DeadSet]) -> Vec<(usize, Vec<Card>)> {
    let first_joker = hand.iter().copied().find(|c| c.is_joker());
    let mut out = Vec::new();
    for (i, s) in sets.iter().enumerate() {
        let fit: Vec<Card> = hand
            .iter()
            .copied()
            .filter(|c| !c.is_joker() && c.rank == s.rank)
            .collect();
        for &c in &fit {
            out.push((i, vec![c]));
        }
        if fit.len() >= 2 {
            out.push((i, vec![fit[0], fit[1]]));
        }
        if let Some(j) = first_joker {
            out.push((i, vec![j]));
        }
    }
    out
}

/// Nilai sebuah langkah (makin besar makin bagus). None kalau langkahnya tidak sah.
fn evaluate(before: &GameState, action: &Action, seat: usize) -> Option<i32> {
    let mut g = before.clone();
    g.apply(seat, action.clone()).ok()?;

    let hand = &g.hands[seat];
    let pts = points(hand);
    let jokers_used = joker_count(&before.hands[seat]) - joker_count(hand);

    // Fase pembuka: seri disembunyikan sampai semua selesai. Buang poin sebanyak mungkin,
    // tapi hemat joker dan sisakan kemungkinan melangkah di fase main.
    if before.phase == Phase::Opening {
        let removed = points(&before.hands[seat]) - pts;
        let future = can_open(hand) || can_kill(hand);
        return Some(removed - JOKER_COST * jokers_used + if future { 15 } else { 0 });
    }

    // Menghabiskan kartu: Song (-100) lebih baik dari Leng (-50).
    if g.phase == Phase::Over {
        if let Some(r) = &g.result {
            if r.winner == Some(seat) {
                return Some(match r.outcome {
                    Outcome::Song => 10_000,
                    Outcome::Leng => 9_000,
                    Outcome::AllDead => 0,
                });
            }
        }
    }

    // Selain itu: sedikit poin tersisa, sedikit kartu, masih punya langkah berikutnya
    // (pemain tanpa langkah otomatis mati), dan hemat joker.
    let future = can_extend(hand, &g.table)
        || can_open(hand)
        || can_kill(hand)
        || can_add_dead(hand, &g.sets);
    Some(-pts - 2 * hand.len() as i32 + if future { 20 } else { -30 } - JOKER_COST * jokers_used)
}

/// Pilih satu aksi terbaik untuk `seat`, atau None kalau kursi itu tidak bisa bergerak
/// (mati, bukan gilirannya, atau sudah menurunkan seri pembuka).
pub fn choose(g: &GameState, seat: usize) -> Option<Action> {
    if seat >= PLAYERS || !g.alive[seat] {
        return None;
    }
    match g.phase {
        Phase::Over => return None,
        Phase::Playing if g.turn != seat => return None,
        _ => {}
    }

    let hand = &g.hands[seat];
    let mut best: Option<(i32, Action)> = None;
    let mut consider = |action: Action| {
        if let Some(v) = evaluate(g, &action, seat) {
            if best.as_ref().map_or(true, |(b, _)| v > *b) {
                best = Some((v, action));
            }
        }
    };

    for cards in series_candidates(hand) {
        consider(Action::NewSeries { cards });
    }
    if g.phase == Phase::Playing {
        for (series, cards) in extend_candidates(hand, &g.table) {
            consider(Action::Extend { series, cards });
        }
        for cards in kill_candidates(hand) {
            consider(Action::Kill { cards });
        }
        for (set, cards) in add_dead_candidates(hand, &g.sets) {
            consider(Action::AddDead { set, cards });
        }
    }

    best.map(|(_, action)| action)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lima bot memainkan 200 ronde acak sampai selesai. Kalau bot pernah mengirim
    /// langkah tidak sah atau tidak menemukan langkah padahal ada, tes ini gagal.
    #[test]
    fn bots_can_play_whole_rounds() {
        for seed in 0..200u64 {
            let mut g = GameState::new_seeded(seed, None);

            for seat in 0..PLAYERS {
                if g.phase != Phase::Opening {
                    break;
                }
                if g.alive[seat] {
                    let a = choose(&g, seat).expect("bot harus bisa membuka seri");
                    g.apply(seat, a).unwrap();
                }
            }

            let mut steps = 0;
            while g.phase == Phase::Playing {
                let t = g.turn;
                let a = choose(&g, t).expect("pemain yang gilirannya pasti punya langkah");
                g.apply(t, a).unwrap();
                steps += 1;
                assert!(steps < 500, "ronde tidak selesai (seed {seed})");
            }
            assert_eq!(g.phase, Phase::Over);
        }
    }
}