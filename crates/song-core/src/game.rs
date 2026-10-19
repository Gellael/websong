use crate::{deal, Card, Combo, Suit, PLAYERS};
use rand::Rng;
use serde::{Deserialize, Serialize};

pub const THREE_DIAMONDS: Card = Card { rank: 3, suit: Suit::Diamonds };

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Action {
    Play(Vec<Card>),
    Pass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameError {
    GameOver,
    NotYourTurn,
    InvalidCombo,
    CardsNotInHand,
    MustStartWith3D,
    DoesNotBeat,
    MustPlay, // tidak boleh pass saat memimpin
}

#[derive(Debug, Clone)]
pub struct GameState {
    pub hands: [Vec<Card>; PLAYERS],
    pub turn: usize,
    /// (pemain yang terakhir membuang, kombinasinya). None = pemain bebas memimpin.
    pub table: Option<(usize, Combo)>,
    pub first_move: bool,
    /// urutan pemain yang kartunya habis (peringkat 1, 2, ...)
    pub finished: Vec<usize>,
    pub over: bool,
}

/// Tampilan state untuk SATU pemain: kartu lawan disembunyikan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerView {
    pub seat: usize,
    pub hand: Vec<Card>,
    pub hand_sizes: [usize; PLAYERS],
    pub turn: usize,
    pub table: Option<(usize, Combo)>,
    pub finished: Vec<usize>,
    pub over: bool,
}

impl GameState {
    pub fn new(rng: &mut impl Rng) -> Self {
        Self::from_hands(deal(rng))
    }

    pub fn from_hands(hands: [Vec<Card>; PLAYERS]) -> Self {
        let starter = hands.iter().position(|h| h.contains(&THREE_DIAMONDS));
        GameState {
            hands,
            turn: starter.unwrap_or(0),
            table: None,
            first_move: starter.is_some(),
            finished: Vec::new(),
            over: false,
        }
    }

    pub fn apply(&mut self, player: usize, action: Action) -> Result<(), GameError> {
        if self.over {
            return Err(GameError::GameOver);
        }
        if player != self.turn {
            return Err(GameError::NotYourTurn);
        }
        match action {
            Action::Play(cards) => self.play(player, cards),
            Action::Pass => self.pass(player),
        }
    }

    fn play(&mut self, player: usize, cards: Vec<Card>) -> Result<(), GameError> {
        let combo = Combo::from_cards(&cards).ok_or(GameError::InvalidCombo)?;

        if !combo.cards.iter().all(|c| self.hands[player].contains(c)) {
            return Err(GameError::CardsNotInHand);
        }
        if self.first_move && !combo.cards.contains(&THREE_DIAMONDS) {
            return Err(GameError::MustStartWith3D);
        }
        if let Some((_, last)) = &self.table {
            if !combo.beats(last) {
                return Err(GameError::DoesNotBeat);
            }
        }

        self.hands[player].retain(|c| !combo.cards.contains(c));
        self.first_move = false;
        self.table = Some((player, combo));

        if self.hands[player].is_empty() {
            self.finished.push(player);
        }

        let active: Vec<usize> = (0..PLAYERS).filter(|&i| !self.hands[i].is_empty()).collect();
        if active.len() <= 1 {
            if let Some(&last) = active.first() {
                self.finished.push(last);
            }
            self.over = true;
            return Ok(());
        }

        self.turn = self.next_active(player);
        Ok(())
    }

    fn pass(&mut self, player: usize) -> Result<(), GameError> {
        let leader = match &self.table {
            Some((leader, _)) => *leader,
            None => return Err(GameError::MustPlay),
        };

        // cari pemain berikutnya; kalau kembali ke leader, putaran selesai
        let mut n = (player + 1) % PLAYERS;
        loop {
            if n == leader {
                self.table = None;
                self.turn = if self.hands[leader].is_empty() {
                    self.next_active(leader)
                } else {
                    leader
                };
                break;
            }
            if !self.hands[n].is_empty() {
                self.turn = n;
                break;
            }
            n = (n + 1) % PLAYERS;
        }
        Ok(())
    }

    fn next_active(&self, from: usize) -> usize {
        let mut n = (from + 1) % PLAYERS;
        while self.hands[n].is_empty() {
            n = (n + 1) % PLAYERS;
        }
        n
    }

    pub fn view_for(&self, seat: usize) -> PlayerView {
        let mut hand_sizes = [0; PLAYERS];
        for (i, h) in self.hands.iter().enumerate() {
            hand_sizes[i] = h.len();
        }
        PlayerView {
            seat,
            hand: self.hands[seat].clone(),
            hand_sizes,
            turn: self.turn,
            table: self.table.clone(),
            finished: self.finished.clone(),
            over: self.over,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Suit::*;

    fn c(rank: u8, suit: Suit) -> Card {
        Card { rank, suit }
    }

    fn sample() -> GameState {
        GameState::from_hands([
            vec![c(3, Diamonds), c(9, Clubs)],
            vec![c(4, Diamonds), c(10, Clubs)],
            vec![c(5, Diamonds), c(11, Clubs)],
            vec![c(6, Diamonds), c(12, Clubs)],
            vec![c(7, Diamonds), c(13, Clubs)],
        ])
    }

    #[test]
    fn new_game_is_valid() {
        let g = GameState::new(&mut rand::thread_rng());
        assert!(g.hands.iter().all(|h| h.len() == 10));
        assert!(g.hands[g.turn].contains(&THREE_DIAMONDS));
    }

    #[test]
    fn first_move_must_contain_3d() {
        let mut g = sample();
        assert_eq!(
            g.apply(0, Action::Play(vec![c(9, Clubs)])),
            Err(GameError::MustStartWith3D)
        );
        assert_eq!(g.apply(0, Action::Play(vec![c(3, Diamonds)])), Ok(()));
        assert_eq!(g.turn, 1);
    }

    #[test]
    fn cannot_play_out_of_turn_or_unowned_cards() {
        let mut g = sample();
        assert_eq!(
            g.apply(1, Action::Play(vec![c(4, Diamonds)])),
            Err(GameError::NotYourTurn)
        );
        assert_eq!(
            g.apply(0, Action::Play(vec![c(14, Spades)])),
            Err(GameError::CardsNotInHand)
        );
    }

    #[test]
    fn cannot_pass_when_leading() {
        let mut g = sample();
        assert_eq!(g.apply(0, Action::Pass), Err(GameError::MustPlay));
    }

    #[test]
    fn must_beat_the_table() {
        let mut g = sample();
        g.apply(0, Action::Play(vec![c(3, Diamonds)])).unwrap();
        g.apply(1, Action::Play(vec![c(10, Clubs)])).unwrap();
        assert_eq!(
            g.apply(2, Action::Play(vec![c(5, Diamonds)])),
            Err(GameError::DoesNotBeat)
        );
    }

    #[test]
    fn round_resets_after_everyone_passes() {
        let mut g = sample();
        g.apply(0, Action::Play(vec![c(3, Diamonds)])).unwrap();
        for p in 1..PLAYERS {
            g.apply(p, Action::Pass).unwrap();
        }
        assert!(g.table.is_none());
        assert_eq!(g.turn, 0); // yang terakhir membuang memimpin lagi
    }

    #[test]
    fn game_ends_when_one_player_left() {
        let mut g = GameState::from_hands([
            vec![c(3, Diamonds)],
            vec![c(4, Diamonds)],
            vec![c(5, Diamonds)],
            vec![c(6, Diamonds)],
            vec![c(7, Diamonds)],
        ]);
        g.apply(0, Action::Play(vec![c(3, Diamonds)])).unwrap();
        g.apply(1, Action::Play(vec![c(4, Diamonds)])).unwrap();
        g.apply(2, Action::Play(vec![c(5, Diamonds)])).unwrap();
        g.apply(3, Action::Play(vec![c(6, Diamonds)])).unwrap();
        assert!(g.over);
        assert_eq!(g.finished, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn view_hides_other_hands() {
        let g = sample();
        let v = g.view_for(2);
        assert_eq!(v.hand, g.hands[2]);
        assert_eq!(v.hand_sizes, [2, 2, 2, 2, 2]);
    }
}