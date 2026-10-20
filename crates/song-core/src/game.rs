use crate::series::*;
use crate::{deal, Card, PLAYERS};
use rand::Rng;
use serde::{Deserialize, Serialize};

/// Skor maksimal untuk pemain yang mati setelah pernah menurunkan kartu.
pub const MAX_DEAD_SCORE: i32 = 75;
/// Skor untuk pemain yang mati di awal (tidak bisa membuka seri).
pub const OPENING_DEAD_SCORE: i32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Opening, // semua pemain menurunkan seri pertama secara tersembunyi
    Playing,
    Over,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Action {
    NewSeries { cards: Vec<Placed> },
    Extend { series: usize, cards: Vec<Placed> },
    Kill { cards: Vec<Card> },
    Revive { set: usize, dead: Placed, helper: Placed, series: usize },
    AddDead { set: usize, cards: Vec<Card> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    Song,
    Leng,
    AllDead,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoundResult {
    pub outcome: Outcome,
    pub winner: Option<usize>,
    pub scores: [i32; PLAYERS],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameState {
    pub hands: [Vec<Card>; PLAYERS],
    pub dead_cards: Vec<Card>,
    pub phase: Phase,
    pub table: Vec<Series>,
    pub sets: Vec<DeadSet>,
    pending: [Option<Vec<Placed>>; PLAYERS], // seri pembuka yang belum dibuka
    pub alive: [bool; PLAYERS],
    played_any: [bool; PLAYERS],
    pub turn: usize,
    forced_starter: Option<usize>,
    pub result: Option<RoundResult>,
}

/// Tampilan untuk SATU pemain: kartu lawan dan seri pembuka yang belum dibuka disembunyikan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerView {
    pub seat: usize,
    pub hand: Vec<Card>,
    pub hand_sizes: [usize; PLAYERS],
    pub table: Vec<Series>,
    pub sets: Vec<DeadSet>,
    pub alive: [bool; PLAYERS],
    pub opened: [bool; PLAYERS],
    pub my_pending: Option<Vec<Placed>>,
    pub turn: usize,
    pub phase: Phase,
    pub result: Option<RoundResult>,
}

fn remove_cards(hand: &mut Vec<Card>, cards: &[Placed]) {
    hand.retain(|c| !cards.iter().any(|p| p.card.id == c.id));
}

fn hand_points(hand: &[Card]) -> i32 {
    hand.iter().map(|c| c.points()).sum()
}

impl GameState {
    /// starter = None: ditentukan dari seri pembuka terendah (ronde pertama).
    /// starter = Some(kursi): dipakai di ronde berikutnya.
    pub fn new(rng: &mut impl Rng, starter: Option<usize>) -> Self {
        let d = deal(rng);
        Self::from_hands(d.hands, d.dead, starter)
    }
        /// Kocokan deterministik dari seed (dipakai di WASM, seed dari JS).
    pub fn new_seeded(seed: u64, starter: Option<usize>) -> Self {
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
        Self::new(&mut rng, starter)
    }

    pub fn from_hands(
        hands: [Vec<Card>; PLAYERS],
        dead_cards: Vec<Card>,
        forced_starter: Option<usize>,
    ) -> Self {
        let mut g = GameState {
            hands,
            dead_cards,
            phase: Phase::Opening,
            table: Vec::new(),
            sets: Vec::new(),
            pending: Default::default(),
            alive: [true; PLAYERS],
            played_any: [false; PLAYERS],
            turn: 0,
            forced_starter,
            result: None,
        };
        // yang tidak bisa membuka seri langsung mati di awal
        for i in 0..PLAYERS {
            if !can_open(&g.hands[i]) {
                g.alive[i] = false;
            }
        }
        g.check_opening_done();
        g
    }

    pub fn apply(&mut self, player: usize, action: Action) -> Result<(), GameError> {
        match self.phase {
            Phase::Over => Err(GameError::GameOver),
            Phase::Opening => self.apply_opening(player, action),
            Phase::Playing => self.apply_playing(player, action),
        }
    }

    fn apply_opening(&mut self, player: usize, action: Action) -> Result<(), GameError> {
        let Action::NewSeries { cards } = action else {
            return Err(GameError::WrongPhase);
        };
        if !self.alive[player] {
            return Err(GameError::NotAlive);
        }
        if self.pending[player].is_some() {
            return Err(GameError::AlreadyOpened);
        }
        check_in_hand(&self.hands[player], &cards)?;
        build_series(player, cards.clone())?;

        remove_cards(&mut self.hands[player], &cards);
        self.pending[player] = Some(cards);
        self.check_opening_done();
        Ok(())
    }

    /// Kalau semua pemain hidup sudah menurunkan seri pembuka: buka serentak.
    fn check_opening_done(&mut self) {
        if self.phase != Phase::Opening {
            return;
        }
        if !(0..PLAYERS).all(|i| !self.alive[i] || self.pending[i].is_some()) {
            return;
        }
        for i in 0..PLAYERS {
            if let Some(cards) = self.pending[i].take() {
                let s = build_series(i, cards).expect("sudah divalidasi saat dikirim");
                self.table.push(s);
                self.played_any[i] = true;
            }
        }
        if self.table.is_empty() {
            self.finish(Outcome::AllDead, None);
            return;
        }
        let starter = self
            .forced_starter
            .filter(|&s| self.alive[s])
            .unwrap_or_else(|| {
                self.table
                    .iter()
                    .min_by_key(|s| (s.lo(), s.owner))
                    .unwrap()
                    .owner
            });
        self.phase = Phase::Playing;
        self.turn = starter;
        self.settle_turn();
    }

    fn apply_playing(&mut self, player: usize, action: Action) -> Result<(), GameError> {
        if player != self.turn {
            return Err(GameError::NotYourTurn);
        }

        let is_song = match action {
            Action::NewSeries { cards } => {
                check_in_hand(&self.hands[player], &cards)?;
                let s = build_series(player, cards.clone())?;
                remove_cards(&mut self.hands[player], &cards);
                self.table.push(s);
                true
            }
            Action::Extend { series, cards } => {
                check_in_hand(&self.hands[player], &cards)?;
                let s = self.table.get_mut(series).ok_or(GameError::NoSuchSeries)?;
                extend_series(s, cards.clone())?;
                remove_cards(&mut self.hands[player], &cards);
                false
            }
            Action::Kill { cards } => {
                let wrapped: Vec<Placed> =
                    cards.iter().map(|&card| Placed { card, pos: 0 }).collect();
                check_in_hand(&self.hands[player], &wrapped)?;
                let set = build_dead_set(player, &cards)?;
                self.hands[player].retain(|c| !cards.iter().any(|k| k.id == c.id));
                self.sets.push(set);
                false
            }
                        Action::AddDead { set, cards } => {
                let wrapped: Vec<Placed> =
                    cards.iter().map(|&card| Placed { card, pos: 0 }).collect();
                check_in_hand(&self.hands[player], &wrapped)?;
                let ds = self.sets.get_mut(set).ok_or(GameError::NoSuchSet)?;
                add_to_dead_set(ds, &cards)?;
                self.hands[player].retain(|c| !cards.iter().any(|k| k.id == c.id));
                false
            }
            Action::Revive { set, dead, helper, series } => {
                check_in_hand(&self.hands[player], &[helper])?;
                let mut ds = self.sets.get(set).ok_or(GameError::NoSuchSet)?.clone();
                if REVIVE_OWN_SETS_ONLY && ds.owner != player {
                    return Err(GameError::NotYourSet);
                }
                let mut sr = self.table.get(series).ok_or(GameError::NoSuchSeries)?.clone();
                revive(&mut ds, &mut sr, dead, helper)?;

                remove_cards(&mut self.hands[player], &[helper]);
                self.table[series] = sr;
                if ds.cards.is_empty() {
                    self.sets.remove(set);
                } else {
                    self.sets[set] = ds;
                }
                false
            }
        };
        self.played_any[player] = true;

        if self.hands[player].is_empty() {
            let outcome = if is_song { Outcome::Song } else { Outcome::Leng };
            self.finish(outcome, Some(player));
            return Ok(());
        }

        self.turn = self.next_alive(player);
        self.settle_turn();
        Ok(())
    }

    /// Pastikan pemain yang gilirannya punya langkah; kalau tidak, dia mati otomatis.
    fn settle_turn(&mut self) {
        loop {
            if !self.alive.iter().any(|&a| a) {
                self.finish(Outcome::AllDead, None);
                return;
            }
            if !self.alive[self.turn] {
                self.turn = self.next_alive(self.turn);
                continue;
            }
            if self.has_move(self.turn) {
                return;
            }
            self.alive[self.turn] = false;
        }
    }

    fn has_move(&self, p: usize) -> bool {
        let h = &self.hands[p];
        can_extend(h, &self.table)
            || can_open(h)
            || can_kill(h)
            || can_add_dead(h, &self.sets)
            || can_revive(p, h, &self.sets, &self.table)
    }

    /// Hanya dipanggil kalau minimal satu pemain masih hidup.
    fn next_alive(&self, from: usize) -> usize {
        let mut n = (from + 1) % PLAYERS;
        while !self.alive[n] {
            n = (n + 1) % PLAYERS;
        }
        n
    }

    fn finish(&mut self, outcome: Outcome, winner: Option<usize>) {
        let mut scores = [0i32; PLAYERS];
        for i in 0..PLAYERS {
            scores[i] = if Some(i) == winner {
                match outcome {
                    Outcome::Song => -100,
                    Outcome::Leng => -50,
                    Outcome::AllDead => 0,
                }
            } else if !self.played_any[i] {
                OPENING_DEAD_SCORE
            } else {
                hand_points(&self.hands[i]).min(MAX_DEAD_SCORE)
            };
        }
        self.phase = Phase::Over;
        self.result = Some(RoundResult { outcome, winner, scores });
    }

    pub fn view_for(&self, seat: usize) -> PlayerView {
        let mut hand_sizes = [0; PLAYERS];
        let mut opened = [false; PLAYERS];
        for i in 0..PLAYERS {
            hand_sizes[i] = self.hands[i].len();
            opened[i] = self.pending[i].is_some() || self.played_any[i];
        }
        PlayerView {
            seat,
            hand: self.hands[seat].clone(),
            hand_sizes,
            table: self.table.clone(),
            sets: self.sets.clone(),
            alive: self.alive,
            opened,
            my_pending: self.pending[seat].clone(),
            turn: self.turn,
            phase: self.phase,
            result: self.result.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Suit::*;
    use crate::Suit;

        fn opened_game(p0_extra: Vec<Card>) -> GameState {
        let mut p0 = vec![c(1, Hearts, 20), c(2, Hearts, 21), c(3, Hearts, 22)];
        p0.extend(p0_extra);
        let mut g = GameState::from_hands(
            [
                p0,
                vec![c(5, Hearts, 0), c(6, Hearts, 1), c(7, Hearts, 2), c(14, Joker, 26)],
                vec![c(8, Clubs, 8), c(9, Clubs, 9), c(10, Clubs, 10), c(2, Spades, 11)],
                vec![c(11, Diamonds, 12), c(12, Diamonds, 13), c(13, Diamonds, 14), c(2, Clubs, 15)],
                vec![c(3, Spades, 16), c(4, Spades, 17), c(5, Spades, 18), c(6, Spades, 19)],
            ],
            vec![],
            None,
        );
        let opens: [Vec<Placed>; PLAYERS] = [
            vec![pl(c(1, Hearts, 20), 1), pl(c(2, Hearts, 21), 2), pl(c(3, Hearts, 22), 3)],
            vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)],
            vec![pl(c(8, Clubs, 8), 8), pl(c(9, Clubs, 9), 9), pl(c(10, Clubs, 10), 10)],
            vec![pl(c(11, Diamonds, 12), 11), pl(c(12, Diamonds, 13), 12), pl(c(13, Diamonds, 14), 13)],
            vec![pl(c(3, Spades, 16), 3), pl(c(4, Spades, 17), 4), pl(c(5, Spades, 18), 5)],
        ];
        for (i, cards) in opens.into_iter().enumerate() {
            g.apply(i, Action::NewSeries { cards }).unwrap();
        }
        g
    }

    #[test]
    fn kill_removes_cards_from_hand() {
        let mut g = opened_game(vec![
            c(9, Clubs, 30), c(9, Spades, 31), c(9, Diamonds, 32), c(13, Clubs, 33),
        ]);
        assert_eq!(g.turn, 0);

        // angka tidak sama -> ditolak, tidak ada yang berubah
        assert_eq!(
            g.apply(0, Action::Kill { cards: vec![c(9, Clubs, 30), c(9, Spades, 31), c(13, Clubs, 33)] }),
            Err(GameError::BadSet)
        );
        assert_eq!(g.hands[0].len(), 4);

        g.apply(0, Action::Kill { cards: vec![c(9, Clubs, 30), c(9, Spades, 31), c(9, Diamonds, 32)] })
            .unwrap();
        assert_eq!(g.hands[0].len(), 1);
        assert_eq!(g.sets.len(), 1);
        assert_eq!(g.turn, 1);
    }

    #[test]
    fn revive_extends_series_and_can_win_with_leng() {
        let mut g = opened_game(vec![c(4, Hearts, 43)]);
        g.sets.push(DeadSet {
            owner: 0,
            rank: 5,
            cards: vec![c(5, Hearts, 40), c(5, Hearts, 41), c(5, Clubs, 42)],
        });

        // jenis kartu mati tidak cocok dengan seri ♥
        assert_eq!(
            g.apply(0, Action::Revive {
                set: 0,
                dead: pl(c(5, Clubs, 42), 5),
                helper: pl(c(4, Hearts, 43), 4),
                series: 0,
            }),
            Err(GameError::SuitMismatch)
        );
        assert_eq!(g.sets[0].cards.len(), 3);

        g.apply(0, Action::Revive {
            set: 0,
            dead: pl(c(5, Hearts, 40), 5),
            helper: pl(c(4, Hearts, 43), 4),
            series: 0,
        })
        .unwrap();
        assert_eq!(g.table[0].hi(), 5);
        assert_eq!(g.sets[0].cards.len(), 2);

        // kartu di tangan habis lewat menyambung = Leng
        let r = g.result.unwrap();
        assert_eq!(r.outcome, Outcome::Leng);
        assert_eq!(r.winner, Some(0));
    }
    fn c(rank: u8, suit: Suit, id: u8) -> Card {
        Card { rank, suit, id }
    }
    fn pl(card: Card, pos: u8) -> Placed {
        Placed { card, pos }
    }

    fn sample() -> GameState {
        GameState::from_hands(
            [
                vec![c(5, Hearts, 0), c(6, Hearts, 1), c(7, Hearts, 2), c(9, Spades, 3)],
                vec![c(1, Diamonds, 4), c(2, Diamonds, 5), c(3, Diamonds, 6), c(4, Diamonds, 7)],
                vec![c(8, Clubs, 8), c(9, Clubs, 9), c(10, Clubs, 10), c(2, Spades, 11)],
                vec![c(11, Diamonds, 12), c(12, Diamonds, 13), c(13, Diamonds, 14), c(2, Clubs, 15)],
                vec![c(3, Spades, 16), c(4, Spades, 17), c(5, Spades, 18), c(6, Spades, 19)],
            ],
            vec![],
            None,
        )
    }

    fn open_all(g: &mut GameState) {
        let opens: [Vec<Placed>; PLAYERS] = [
            vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)],
            vec![pl(c(1, Diamonds, 4), 1), pl(c(2, Diamonds, 5), 2), pl(c(3, Diamonds, 6), 3)],
            vec![pl(c(8, Clubs, 8), 8), pl(c(9, Clubs, 9), 9), pl(c(10, Clubs, 10), 10)],
            vec![pl(c(11, Diamonds, 12), 11), pl(c(12, Diamonds, 13), 12), pl(c(13, Diamonds, 14), 13)],
            vec![pl(c(3, Spades, 16), 3), pl(c(4, Spades, 17), 4), pl(c(5, Spades, 18), 5)],
        ];
        for (i, cards) in opens.into_iter().enumerate() {
            g.apply(i, Action::NewSeries { cards }).unwrap();
        }
    }

    #[test]
    fn new_random_game_starts_in_opening() {
        let g = GameState::new(&mut rand::thread_rng(), None);
        assert!(g.hands.iter().all(|h| h.len() == 20));
        assert_eq!(g.dead_cards.len(), 8);
    }

    #[test]
    fn lowest_opening_series_goes_first() {
        let mut g = sample();
        assert_eq!(g.phase, Phase::Opening);
        open_all(&mut g);
        assert_eq!(g.phase, Phase::Playing);
        assert_eq!(g.table.len(), 5);
        assert_eq!(g.turn, 1); // A-2-3 paling rendah
    }

    #[test]
    fn opening_cannot_be_repeated_or_played_out_of_turn() {
        let mut g = sample();
        let cards = vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)];
        g.apply(0, Action::NewSeries { cards: cards.clone() }).unwrap();
        assert_eq!(g.apply(0, Action::NewSeries { cards }), Err(GameError::AlreadyOpened));
        assert_eq!(
            g.apply(1, Action::Extend { series: 0, cards: vec![] }),
            Err(GameError::WrongPhase)
        );
    }

    #[test]
    fn emptying_hand_by_extending_is_leng() {
        let mut g = sample();
        open_all(&mut g);
        assert_eq!(
            g.apply(0, Action::Extend { series: 1, cards: vec![pl(c(9, Spades, 3), 9)] }),
            Err(GameError::NotYourTurn)
        );
        g.apply(1, Action::Extend { series: 1, cards: vec![pl(c(4, Diamonds, 7), 4)] })
            .unwrap();
        assert_eq!(g.phase, Phase::Over);
        let r = g.result.unwrap();
        assert_eq!(r.outcome, Outcome::Leng);
        assert_eq!(r.winner, Some(1));
        assert_eq!(r.scores[1], -50);
    }

    #[test]
    fn view_hides_other_hands() {
        let g = sample();
        let v = g.view_for(2);
        assert_eq!(v.hand, g.hands[2]);
        assert_eq!(v.hand_sizes, [4, 4, 4, 4, 4]);
    }

    #[test]
    fn song_scores_leftover_cards_including_jokers() {
        let mut g = GameState::from_hands(
            [
                vec![c(1, Hearts, 20), c(2, Hearts, 21), c(3, Hearts, 22),
                    c(4, Spades, 23), c(5, Spades, 24), c(6, Spades, 25)],
                vec![c(5, Hearts, 0), c(6, Hearts, 1), c(7, Hearts, 2), c(14, Joker, 26)],
                vec![c(8, Clubs, 8), c(9, Clubs, 9), c(10, Clubs, 10), c(2, Spades, 11)],
                vec![c(11, Diamonds, 12), c(12, Diamonds, 13), c(13, Diamonds, 14), c(2, Clubs, 15)],
                vec![c(3, Spades, 16), c(4, Spades, 17), c(5, Spades, 18), c(6, Spades, 19)],
            ],
            vec![],
            None,
        );
        let opens: [Vec<Placed>; PLAYERS] = [
            vec![pl(c(1, Hearts, 20), 1), pl(c(2, Hearts, 21), 2), pl(c(3, Hearts, 22), 3)],
            vec![pl(c(5, Hearts, 0), 5), pl(c(6, Hearts, 1), 6), pl(c(7, Hearts, 2), 7)],
            vec![pl(c(8, Clubs, 8), 8), pl(c(9, Clubs, 9), 9), pl(c(10, Clubs, 10), 10)],
            vec![pl(c(11, Diamonds, 12), 11), pl(c(12, Diamonds, 13), 12), pl(c(13, Diamonds, 14), 13)],
            vec![pl(c(3, Spades, 16), 3), pl(c(4, Spades, 17), 4), pl(c(5, Spades, 18), 5)],
        ];
        for (i, cards) in opens.into_iter().enumerate() {
            g.apply(i, Action::NewSeries { cards }).unwrap();
        }
        assert_eq!(g.turn, 0);

        // pemain 0 menghabiskan kartu dengan seri baru = Song
        g.apply(0, Action::NewSeries {
            cards: vec![pl(c(4, Spades, 23), 4), pl(c(5, Spades, 24), 5), pl(c(6, Spades, 25), 6)],
        })
        .unwrap();

        let r = g.result.unwrap();
        assert_eq!(r.outcome, Outcome::Song);
        assert_eq!(r.scores, [-100, 25, 5, 5, 5]); // joker di tangan = 25
    }
}