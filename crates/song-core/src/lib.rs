use rand::seq::SliceRandom;
use rand::Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Suit {
    Diamonds,
    Clubs,
    Hearts,
    Spades,
}

/// rank: 3..=10 angka, 11=J, 12=Q, 13=K, 14=A, 15=2
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Card {
    pub rank: u8,
    pub suit: Suit,
}

pub const PLAYERS: usize = 5;

pub fn new_deck() -> Vec<Card> {
    let suits = [Suit::Diamonds, Suit::Clubs, Suit::Hearts, Suit::Spades];
    let mut deck = Vec::with_capacity(52);
    for suit in suits {
        for rank in 3..=15 {
            deck.push(Card { rank, suit });
        }
    }
    deck
}

/// Kocok dan bagi: 5 pemain x 10 kartu (2♦ dan 2♣ dibuang).
pub fn deal(rng: &mut impl Rng) -> [Vec<Card>; PLAYERS] {
    let mut deck = new_deck();
    deck.retain(|c| !(c.rank == 15 && matches!(c.suit, Suit::Diamonds | Suit::Clubs)));
    deck.shuffle(rng);

    let mut hands: [Vec<Card>; PLAYERS] = Default::default();
    for (i, card) in deck.into_iter().enumerate() {
        hands[i % PLAYERS].push(card);
    }
    for hand in hands.iter_mut() {
        hand.sort();
    }
    hands
}

pub fn deal_random() -> [Vec<Card>; PLAYERS] {
    deal(&mut rand::thread_rng())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn deck_has_52_unique_cards() {
        let deck = new_deck();
        let set: HashSet<_> = deck.iter().collect();
        assert_eq!(deck.len(), 52);
        assert_eq!(set.len(), 52);
    }

    #[test]
    fn deal_gives_five_hands_of_ten_without_duplicates() {
        let hands = deal_random();
        let mut all = HashSet::new();
        for hand in &hands {
            assert_eq!(hand.len(), 10);
            for card in hand {
                assert!(all.insert(*card), "kartu duplikat: {:?}", card);
            }
        }
        assert_eq!(all.len(), 50);
    }
}