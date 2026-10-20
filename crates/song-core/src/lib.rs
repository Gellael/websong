pub mod game;
pub mod series;
pub mod bot;
pub use game::*;
pub use series::*;

use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Suit {
    Diamonds,
    Clubs,
    Hearts,
    Spades,
    Joker,
}

/// rank: 1=A, 2..=10, 11=J, 12=Q, 13=K, 14=Joker
/// id: unik per kartu fisik (0..108) karena ada 2 pack
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Card {
    pub rank: u8,
    pub suit: Suit,
    pub id: u8,
}

impl Card {
    /// Joker asli atau A♠ (berfungsi sebagai joker).
    pub fn is_joker(&self) -> bool {
        self.suit == Suit::Joker || (self.rank == 1 && self.suit == Suit::Spades)
    }

    /// Nilai kartu yang tersisa di tangan.
    pub fn points(&self) -> i32 {
        if self.is_joker() {
            25
        } else {
            match self.rank {
                1 => 15,
                10..=13 => 10,
                _ => 5,
            }
        }
    }
}

pub const PLAYERS: usize = 5;
pub const HAND_SIZE: usize = 20;
pub const DEAD_CARDS: usize = 8;

/// 2 pack lengkap (104) + 4 joker = 108 kartu.
pub fn new_deck() -> Vec<Card> {
    let suits = [Suit::Diamonds, Suit::Clubs, Suit::Hearts, Suit::Spades];
    let mut deck = Vec::with_capacity(108);
    let mut id = 0u8;
    for _pack in 0..2 {
        for suit in suits {
            for rank in 1..=13 {
                deck.push(Card { rank, suit, id });
                id += 1;
            }
        }
    }
    for _ in 0..4 {
        deck.push(Card { rank: 14, suit: Suit::Joker, id });
        id += 1;
    }
    deck
}

pub struct Deal {
    pub hands: [Vec<Card>; PLAYERS],
    pub dead: Vec<Card>, // 8 kartu mati
}

pub fn deal(rng: &mut impl Rng) -> Deal {
    let mut deck = new_deck();
    deck.shuffle(rng);

    let mut hands: [Vec<Card>; PLAYERS] = Default::default();
    for (i, hand) in hands.iter_mut().enumerate() {
        *hand = deck[i * HAND_SIZE..(i + 1) * HAND_SIZE].to_vec();
        hand.sort();
    }
    let dead = deck[PLAYERS * HAND_SIZE..].to_vec();
    Deal { hands, dead }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn deck_has_108_unique_cards_with_6_jokers() {
        let deck = new_deck();
        let ids: HashSet<_> = deck.iter().map(|c| c.id).collect();
        assert_eq!(deck.len(), 108);
        assert_eq!(ids.len(), 108);
        assert_eq!(deck.iter().filter(|c| c.is_joker()).count(), 6);
    }

    #[test]
    fn deal_gives_20_each_and_8_dead() {
        let d = deal(&mut rand::thread_rng());
        let mut all = HashSet::new();
        for hand in &d.hands {
            assert_eq!(hand.len(), HAND_SIZE);
            for c in hand {
                assert!(all.insert(c.id));
            }
        }
        assert_eq!(d.dead.len(), DEAD_CARDS);
        for c in &d.dead {
            assert!(all.insert(c.id));
        }
        assert_eq!(all.len(), 108);
    }
}